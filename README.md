# Disposable staging integration fixture

Synthetic pages for verifying StackSnack release checks.


## Automatic staging deployments

Push the current staging PR head to `preview` to deploy and verify it.
The staging workflow deploys only the disposable green Render service, verifies the
new build and exact commit, publishes its non-production deployment, waits for the
StackSnack Release Gate, then runs the hosted Action in the private StackSnack repo.
The public receipt contains only IDs, commit, and pass/fail metadata.

Keep Render auto-deploy off; use this workflow for preview redeploys too. Direct
Render Dashboard deploys bypass it because workspace webhooks require Render Pro.
Never place a personal OAuth token or the private scanner source in this repo.
