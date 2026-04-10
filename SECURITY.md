# Security

Report vulnerabilities privately to the repository maintainers (do not open public issues for undisclosed security bugs).

## Secrets

- Never commit `.env`, Apple Weather `.p8` keys, AWS credentials, or station API keys.
- Station API keys are shown **once** at registration; rotate by re-registering or a future rotation endpoint.

## API

- All station routes require `Authorization: Bearer <apiKey>`.
- `POST /api/stations/register` requires header `x-admin-secret: <ADMIN_SECRET>`.
- Cron routes require `Authorization: Bearer <CRON_SECRET>` (set in Vercel for scheduled jobs).

## Abuse

- Rate limits apply per station for polling, telemetry, and S3 presign (see server env defaults).
- Presigned S3 uploads are scoped per station key prefix.

## Edge device

- Use HTTPS for `CLOUD_BASE_URL` in production.
- GPS is required for fleet geometry; mock GPS is for development only.

## Privacy and retention

See [PRIVACY.md](./PRIVACY.md) for field-of-view considerations and S3 lifecycle guidance.
