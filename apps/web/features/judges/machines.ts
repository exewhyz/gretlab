import {
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

/*
 * Starting and ending judge machines on AWS (EC2, Sydney), from the launch template
 * `gretlab-judge` (deploy/judge-machine-boot.sh runs on first boot). The website signs in to
 * AWS through Vercel's OIDC federation as the role in JUDGES_AWS_ROLE_ARN, which may only start
 * machines from that template, pass only the judge machine's role, and end only machines tagged
 * gretlab:judge=true. No AWS keys are stored anywhere.
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
}

export const REGION = "ap-southeast-2"

class AwsMachines implements Machines {
  private client: EC2Client
  constructor(roleArn: string) {
    this.client = new EC2Client({
      region: REGION,
      credentials: awsCredentialsProvider({ roleArn }),
    })
  }

  async start(input: { size: string; pool: string | null; rowId: string }) {
    const tags = [
      { Key: "gretlab:judge", Value: "true" },
      {
        Key: "Name",
        Value: `gretlab-judge${input.pool ? `-${input.pool}` : ""}`,
      },
      { Key: "gretlab-machine", Value: input.rowId },
      ...(input.pool ? [{ Key: "gretlab-pool", Value: input.pool }] : []),
    ]
    const out = await this.client.send(
      new RunInstancesCommand({
        LaunchTemplate: {
          LaunchTemplateName: "gretlab-judge",
          Version: "$Latest",
        },
        InstanceType: input.size as never,
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
      })
    )
    const id = out.Instances?.[0]?.InstanceId
    if (!id) throw new Error("AWS started no machine")
    return id
  }

  async end(instanceId: string) {
    await this.client.send(
      new TerminateInstancesCommand({ InstanceIds: [instanceId] })
    )
  }

  async states(instanceIds: string[]) {
    const states = new Map<string, MachineState>()
    if (instanceIds.length === 0) return states
    const out = await this.client.send(
      new DescribeInstancesCommand({ InstanceIds: instanceIds })
    )
    for (const reservation of out.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        if (instance.InstanceId && instance.State?.Name) {
          states.set(instance.InstanceId, instance.State.Name as MachineState)
        }
      }
    }
    return states
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
