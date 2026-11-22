import * as EC2 from "@aws-sdk/client-ec2"
import { DescribeParametersCommand, SSMClient } from "@aws-sdk/client-ssm"
import {
  DecodeAuthorizationMessageCommand,
  STSClient,
} from "@aws-sdk/client-sts"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

/*
 * Starting and ending judge machines on AWS (EC2, Sydney), from the launch template
 * `gretlab-judge` (deploy/judge-machine-boot.sh runs on first boot). The website signs in to
 * AWS through Vercel's OIDC federation as the role in JUDGES_AWS_ROLE_ARN, which may only start
 * machines from that template, pass only the judge machine's role, end only machines tagged
 * gretlab:judge=true, and read (never change) the template, the database parameter's name and
 * its own refusals. No AWS keys are stored anywhere.
 *
 * JUDGES_PROVIDER=fake swaps AWS for an in-memory stand-in (the e2e suites), and an unset
 * JUDGES_AWS_ROLE_ARN means machines can't be started here (a local copy, a preview).
 */

export type MachineState =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "shutting-down"
  | "terminated"

/** One line of the setup check: what was tried, whether it worked, and what to do if not. */
export interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

/** The database address new machines read (SSM, readable only by the machine's role). */
export const DATABASE_PARAMETER = "/gretlab/judge/database-url"

export interface Machines {
  /** Starts one machine; answers its instance id. */
  start(input: {
    size: string
    /** The organization's address for its own judge; null for a shared one. */
    pool: string | null
    /** The judge_machines row, kept on the machine as a tag. */
    rowId: string
  }): Promise<string>
  /** Ends a machine (it can't be started again). */
  end(instanceId: string): Promise<void>
  /** Each machine's state; a machine AWS no longer knows is left out. */
  states(instanceIds: string[]): Promise<Map<string, MachineState>>
  /** Tries every piece a start needs, changing nothing (a dry-run start). */
  check(size: string): Promise<CheckResult[]>
}

export const REGION = "ap-southeast-2"

/*
 * The EC2 SDK, as GretLab uses it. Its own types describe all of EC2 (19 MB of them), and
 * relating GretLab's objects to them made every typecheck of the web app take 320 s instead of
 * 7 s (measured 22 November 2026). So the real SDK runs, imported normally, but TypeScript sees
 * only this: the four commands used, with what's read from their answers.
 */
type Ec2Command = { readonly input: unknown }
interface Ec2Sdk {
  EC2Client: new (config: { region: string; credentials: unknown }) => {
    send(command: Ec2Command): Promise<unknown>
  }
  RunInstancesCommand: new (
    input: StartRequest & { DryRun?: boolean }
  ) => Ec2Command
  TerminateInstancesCommand: new (input: {
    InstanceIds: string[]
  }) => Ec2Command
  DescribeInstancesCommand: new (input: { InstanceIds: string[] }) => Ec2Command
  DescribeLaunchTemplatesCommand: new (input: {
    LaunchTemplateNames: string[]
  }) => Ec2Command
}
const ec2Sdk = EC2 as unknown as Ec2Sdk
type Ec2Client = InstanceType<Ec2Sdk["EC2Client"]>

/** The parts of EC2's answers that are read. */
interface RunInstancesOutput {
  Instances?: { InstanceId?: string }[]
}
interface DescribeInstancesOutput {
  Reservations?: {
    Instances?: { InstanceId?: string; State?: { Name?: string } }[]
  }[]
}
interface DescribeLaunchTemplatesOutput {
  LaunchTemplates?: { LatestVersionNumber?: number }[]
}

interface StartRequest {
  LaunchTemplate: { LaunchTemplateName: string; Version: string }
  InstanceType: string
  MinCount: number
  MaxCount: number
  ClientToken: string
  TagSpecifications: {
    ResourceType: "instance" | "volume"
    Tags: { Key: string; Value: string }[]
  }[]
}

/** What Start sends AWS, so the setup check's dry run tries exactly the same thing. */
function startRequest(input: {
  size: string
  pool: string | null
  rowId: string
}): StartRequest {
  const tags = [
    { Key: "gretlab:judge", Value: "true" },
    {
      Key: "Name",
      Value: `gretlab-judge${input.pool ? `-${input.pool}` : ""}`,
    },
    { Key: "gretlab-machine", Value: input.rowId },
    ...(input.pool ? [{ Key: "gretlab-pool", Value: input.pool }] : []),
  ]
  return {
    LaunchTemplate: { LaunchTemplateName: "gretlab-judge", Version: "$Latest" },
    InstanceType: input.size,
    MinCount: 1,
    MaxCount: 1,
    // A retried request starts no second machine.
    ClientToken: input.rowId,
    TagSpecifications: [
      { ResourceType: "instance", Tags: tags },
      {
        ResourceType: "volume",
        Tags: [{ Key: "gretlab:judge", Value: "true" }],
      },
    ],
  }
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

class AwsMachines implements Machines {
  private ec2: Ec2Client
  private ssm: SSMClient
  private sts: STSClient
  private credentials: ReturnType<typeof awsCredentialsProvider>
  constructor(private roleArn: string) {
    this.credentials = awsCredentialsProvider({ roleArn })
    const config = { region: REGION, credentials: this.credentials }
    this.ec2 = new ec2Sdk.EC2Client(config)
    this.ssm = new SSMClient(config)
    this.sts = new STSClient(config)
  }

  /** An AWS refusal in words: which action, on what, and why (its encoded part decoded). */
  private async explain(error: unknown) {
    const text = messageOf(error)
    const encoded = text.match(
      /Encoded authorization failure message: (\S+)/
    )?.[1]
    if (!encoded) return text
    try {
      const out = await this.sts.send(
        new DecodeAuthorizationMessageCommand({ EncodedMessage: encoded })
      )
      const decoded = JSON.parse(out.DecodedMessage ?? "{}") as {
        context?: { action?: string; resource?: string }
        matchedStatements?: { items?: unknown[] }
      }
      const why = decoded.matchedStatements?.items?.length
        ? "a rule denies it"
        : "no rule allows it"
      return `AWS refused ${decoded.context?.action ?? "it"} on ${decoded.context?.resource ?? "a resource"}: ${why}. The website's AWS role (gretlab-web-judges) would need to allow it.`
    } catch {
      return text
        .replace(/Encoded authorization failure message: \S+/, "")
        .trim()
    }
  }

  async start(input: { size: string; pool: string | null; rowId: string }) {
    let out: RunInstancesOutput
    try {
      out = (await this.ec2.send(
        new ec2Sdk.RunInstancesCommand(startRequest(input))
      )) as RunInstancesOutput
    } catch (error) {
      throw new Error(await this.explain(error))
    }
    const id = out.Instances?.[0]?.InstanceId
    if (!id) throw new Error("AWS started no machine")
    return id
  }

  async end(instanceId: string) {
    await this.ec2.send(
      new ec2Sdk.TerminateInstancesCommand({ InstanceIds: [instanceId] })
    )
  }

  async states(instanceIds: string[]) {
    const states = new Map<string, MachineState>()
    if (instanceIds.length === 0) return states
    const out = (await this.ec2.send(
      new ec2Sdk.DescribeInstancesCommand({ InstanceIds: instanceIds })
    )) as DescribeInstancesOutput
    for (const reservation of out.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (instance.InstanceId && instance.State?.Name) {
          states.set(instance.InstanceId, instance.State.Name as MachineState)
        }
      }
    }
    return states
  }

  async check(size: string): Promise<CheckResult[]> {
    const results: CheckResult[] = []
    try {
      await this.credentials()
      results.push({
        name: "Signing in to AWS",
        ok: true,
        detail: `As ${this.roleArn.split("/").pop()}, through Vercel's OIDC federation.`,
      })
    } catch (error) {
      results.push({
        name: "Signing in to AWS",
        ok: false,
        detail: `${messageOf(error)}. The role's trust rule must accept this Vercel team, the project's name and production (IAM › Roles › gretlab-web-judges › Trust relationships), and OIDC federation must be on in Vercel (Team issuer).`,
      })
      return results
    }
    try {
      const out = (await this.ec2.send(
        new ec2Sdk.DescribeLaunchTemplatesCommand({
          LaunchTemplateNames: ["gretlab-judge"],
        })
      )) as DescribeLaunchTemplatesOutput
      const template = out.LaunchTemplates?.[0]
      results.push({
        name: "The launch template",
        ok: Boolean(template),
        detail: template
          ? `gretlab-judge, version ${template.LatestVersionNumber}.`
          : "There's no launch template named gretlab-judge in Sydney.",
      })
    } catch (error) {
      results.push({
        name: "The launch template",
        ok: false,
        detail: await this.explain(error),
      })
    }
    try {
      await this.ec2.send(
        new ec2Sdk.RunInstancesCommand({
          ...startRequest({ size, pool: null, rowId: crypto.randomUUID() }),
          DryRun: true,
        })
      )
      results.push({
        name: "Starting a machine (dry run)",
        ok: true,
        detail: "AWS answered without starting one.",
      })
    } catch (error) {
      const dryRunPassed =
        (error as { name?: string } | null)?.name === "DryRunOperation"
      results.push({
        name: "Starting a machine (dry run)",
        ok: dryRunPassed,
        detail: dryRunPassed
          ? `A ${size} machine would start.`
          : await this.explain(error),
      })
    }
    try {
      const out = await this.ssm.send(
        new DescribeParametersCommand({
          ParameterFilters: [{ Key: "Name", Values: [DATABASE_PARAMETER] }],
        })
      )
      const parameter = out.Parameters?.[0]
      results.push({
        name: "The database address for new machines",
        ok: parameter?.Type === "SecureString",
        detail: !parameter
          ? `There's no ${DATABASE_PARAMETER} in SSM Parameter Store (Sydney), so new machines can't reach the database. Store the session pooler's address there as a SecureString.`
          : parameter.Type !== "SecureString"
            ? `${DATABASE_PARAMETER} isn't encrypted (it's a ${parameter.Type}): store it again as a SecureString.`
            : `Stored and encrypted, last changed ${parameter.LastModifiedDate?.toISOString().slice(0, 10) ?? "earlier"}. Its value is never read here.`,
      })
    } catch (error) {
      results.push({
        name: "The database address for new machines",
        ok: false,
        detail: await this.explain(error),
      })
    }
    return results
  }
}

/** For the e2e suites: machines that exist only in this server's memory. */
class FakeMachines implements Machines {
  private machines = new Map<string, MachineState>()
  async start(input: { size: string; pool: string | null; rowId: string }) {
    if (input.pool === "fake-aws-refuses") {
      throw new Error("InsufficientInstanceCapacity: no capacity in this zone")
    }
    const id = `i-fake${input.rowId.replace(/-/g, "").slice(0, 13)}`
    this.machines.set(id, "running")
    return id
  }
  async end(instanceId: string) {
    if (this.machines.has(instanceId))
      this.machines.set(instanceId, "terminated")
  }
  async states(instanceIds: string[]) {
    return new Map(
      instanceIds.flatMap((id) => {
        const state = this.machines.get(id)
        return state ? [[id, state] as const] : []
      })
    )
  }
  async check(size: string): Promise<CheckResult[]> {
    return [
      {
        name: "Signing in to AWS",
        ok: true,
        detail: "The fake AWS (JUDGES_PROVIDER=fake).",
      },
      {
        name: "Starting a machine (dry run)",
        ok: true,
        detail: `A ${size} machine would start.`,
      },
    ]
  }
}

let chosen: Machines | null | undefined

/** The machines this deployment can start, or null when it can't start any. */
export function machines(): Machines | null {
  if (chosen !== undefined) return chosen
  const roleArn = process.env.JUDGES_AWS_ROLE_ARN
  chosen =
    process.env.JUDGES_PROVIDER === "fake"
      ? new FakeMachines()
      : roleArn
        ? new AwsMachines(roleArn)
        : null
  return chosen
}
