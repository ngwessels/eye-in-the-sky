# Privacy and data retention

## Field of view

Sky cameras can capture horizon features, buildings, aircraft, and occasionally people or vehicles. Operators should:

- Aim primarily at the **sky** and minimize private property in frame.
- Document approximate **field of view** and **retention** for their deployment.

## Retention

- Configure **S3 lifecycle rules** on your capture bucket (e.g. transition to cheaper storage or expire objects after N days).
- Calibration uploads under `stations/*/calibration/` can use **shorter TTL** than science imagery.

## Telemetry

Environmental sensor readings are stored for operational correlation. Do not encode personally identifiable information in sensor IDs.

## AI analysis

Vision prompts are scoped to **meteorological structure** (clouds, horizon plausibility). Review your AI provider’s data handling for the models you route through Vercel AI Gateway.
