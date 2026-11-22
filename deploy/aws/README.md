# The AWS side of judge machines (Sydney, ap-southeast-2)

What Dashboard › Judges relies on, as set up on 22 November 2026. `<account>` stands for the AWS
account number. Change these in AWS (IAM, EC2) with an administrator's login, never from the
website: the website's role can't change any of them, by design.

| File | What it is |
| --- | --- |
| `web-trust.json` | Who may act as the website's role `gretlab-web-judges`: only this Vercel team's project `gretlab-web`, in production (OIDC) |
| `web-policy.json` | What that role may do: start machines only from the launch template `gretlab-judge`, in four sizes, tagged `gretlab:judge`; pass only the machine role; see machines; end only tagged ones; and, for the setup check, see the template, that the database parameter exists (never its value) and decode its own refusals |
| `machine-trust.json`, `machine-policy.json` | The machines' role `gretlab-judge-machine`: read the one parameter `/gretlab/judge/database-url`, nothing else |
| `user-data.sh` | The launch template's user data: fetches and runs `deploy/judge-machine-boot.sh` from `main` |

Also in AWS: the security group `gretlab-judge` (no inbound rules), the instance profile
`gretlab-judge-machine`, the OIDC provider `oidc.vercel.com/<team>`, the launch template
`gretlab-judge` (Ubuntu 24.04 from Canonical's SSM parameter, `c7i-flex.large`, IMDSv2 only with
one hop and instance tags readable, a 30 GB encrypted disk) and the SecureString
`/gretlab/judge/database-url`.

After changing a policy: check it with IAM Access Analyzer (`aws accessanalyzer validate-policy`)
and the policy simulator (`aws iam simulate-principal-policy`, with `aws:RequestedRegion` set, or
the project's managed Region rules deny everything in the simulation), then run the setup check
on Dashboard › Judges.
