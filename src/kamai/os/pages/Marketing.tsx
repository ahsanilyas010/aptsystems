import { SectionTitle } from '../../ui'
import { brandMessaging, calendar, heroMessaging, marketingIntro, proofPoints } from '../content/marketing'
import { DataTable, Grid, Highlight, Panel, Stack } from '../components/content-ui'

type Msg = typeof heroMessaging

function Messaging({ m, dot }: { m: Msg; dot?: 'amber' }) {
  return (
    <Panel title={m.title} dot={dot}>
      <h3 className="mb-2 text-[15px] font-bold text-k-dark">{m.headline}</h3>
      <p className="mb-4 text-sm leading-relaxed text-k-muted">{m.body}</p>
      <DataTable {...m.table} />
    </Panel>
  )
}

export function Component() {
  return (
    <Stack>
      <Highlight intro={marketingIntro} />
      <Grid cols={2}>
        <Messaging m={heroMessaging} />
        <Messaging m={brandMessaging} dot="amber" />
      </Grid>
      <SectionTitle>Content Calendar — Next 4 Weeks</SectionTitle>
      <Panel><DataTable {...calendar} /></Panel>
      <SectionTitle>Proof Points to Build NOW</SectionTitle>
      <Panel><DataTable {...proofPoints} /></Panel>
    </Stack>
  )
}
