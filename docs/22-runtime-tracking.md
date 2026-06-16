# Runtime tracking for OneLink/Fonoster production host

Purpose: make the running Fonoster stack traceable without committing secrets, recordings, backups, or certificates.

## Golden rule

Git tracks code, templates, and non-secret runtime patches. The production host keeps secrets and generated files locally.

Never commit:

- `recordings/`
- `logs/`
- `backup-*.sql`
- `*.bak*`
- `config/routr-certs/`
- real `asterisk/config/pjsip_sipuni.conf`
- real `asterisk/config/sipuni_gateways.json`
- real `config/routr-patches/edgeport-image/edgeport.yaml`

Tracked templates:

- `asterisk/config/pjsip_sipuni.conf.example`
- `config/routr-patches/edgeport-image/edgeport.yaml.example`

## Before restart or rebuild

Run from `/root/fonoster-pack/fonoster-docker`:

```bash
./scripts/runtime-parity-check.sh
```

Expected for a no-change restart:

- key image-code files are `SAME` between host and container;
- bind-mounted Asterisk/Routr files are `SAME`;
- compose config hashes for `telephony-bridge`, `voice-runtime`, `apiserver`, `routr`, and `asterisk` are `SAME`.

If any line is `DIFF`, do not restart/rebuild until the difference is classified and either committed, intentionally ignored as a local secret, or reverted.

## Commit policy

Safe to commit:

- bridge/runtime/apiserver source code;
- package manifests and lockfiles;
- non-secret Routr JS patches;
- non-secret Asterisk dialplan `extensions.conf`;
- templates and tracking docs/scripts.

Do not commit live SIP passwords, private keys, certificates, WAV files, SQL backups, or generated registries.
