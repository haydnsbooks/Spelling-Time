## Summary
<!-- State the user-visible change and the problem it solves. -->

## Rationale
<!-- Explain why this approach was chosen and what was replaced. -->

## Implementation
<!-- Summarize the main modules/data/API changes. Include a short representative snippet when it helps reviewers. -->

```tsx
// Example: keep view composition in a feature component and pass typed data/actions through props.
<ActivityMenu stage={stage} term={term} week={week} onLaunch={setActivity} />
```

## UI screenshots
<!-- Include desktop and mobile screenshots for visual changes. Remove this section if there is no UI change. -->

| Desktop | Mobile |
|---|---|
| <!-- screenshot --> | <!-- screenshot --> |

## Build and verification
```sh
npm ci
npm run check
npm run build
npx playwright install chromium
npm test
```

<!-- List the commands actually run and any skipped checks, with reasons. -->

## Data and API impact
<!-- Describe changed data shapes, shard generation, persistence, or Apps Script requirements. -->

## Open questions
<!-- List unresolved decisions, or write "None". -->

## Related issue
<!-- Link an issue, or write "None". -->

## Checklist
- [ ] Source and data modules stay within the project's 300-line target
- [ ] No credentials or private Apps Script source are included
- [ ] Student and teacher flows were reviewed
- [ ] Responsive UI was reviewed on desktop and mobile
- [ ] Data or Apps Script changes are documented
- [ ] Verification results are recorded above
