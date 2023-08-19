# actions

GitHub Actions workflows for @re-taro

## Using Generate Installation Access Token script

```sh
cp ./.github/scripts/gen.sh <to-your-projects>
git update-index --add --chmod=+x <your-copied-script-path>
```

and also you should write this job at the bottom.

```yaml
- name: Revoke GitHub Apps token
  env:
    GITHUB_TOKEN: ${{ steps.bot.outputs.token }}
  run: |
    curl --location --silent --request DELETE \
      --url "${GITHUB_API_URL}/installation/token" \
      --header "Accept: application/vnd.github+json" \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      --header "Authorization: Bearer ${GITHUB_TOKEN}"
```
