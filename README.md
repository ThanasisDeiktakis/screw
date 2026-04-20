# Screw

Hi, my name is Thanasis. At some point I got curious about combining mesh networking ideas with a PWA-based messenger, so I started building one. This is still very much an experiment — call it alpha or early beta — but it already works well enough to deploy and play with. If you have experience in security or cryptography, I would really appreciate any feedback on the implementation.

## What is this

Screw is a decentralized messenger with end-to-end encryption. Messages are encrypted on the client side using RSA-OAEP (for key exchange) and AES-GCM (for message content). The server (called a Spot) stores only encrypted blobs and never has access to plaintext.

The long-term vision includes a mesh-like network of Spots connected through Hubs, so messages can travel between independent servers without any central authority. For now, only a single Spot works — the mesh layer is not yet implemented.

### Architecture

The system is designed around four layers:

- **Client** — a Progressive Web App. Works in any modern browser, can be installed on a phone or desktop. All encryption and decryption happens here. The client never sends plaintext to the server.
- **Spot** — a lightweight Node.js server. Stores encrypted messages and contacts, handles WebSocket connections for real-time delivery, sends push notifications. Each Spot serves its own set of users.
- **Hub** (not implemented) — a relay node that connects Spots together. Hubs don't store messages, only forward them and remember routes. This is the mesh layer.
- **Root** (not implemented) — a discovery service that helps new Spots find Hubs. Can be as simple as a static JSON file with a list of known Hub addresses.

### What is implemented

- End-to-end encrypted personal messages (RSA-OAEP + AES-GCM)
- Message signing (RSA-PSS) to prevent spoofing
- Group chats with symmetric key encryption (AES-GCM)
- Contact management with server-side encrypted address book
- Handshake protocol for key exchange between users
- File sharing through S3-compatible storage (files are encrypted client-side before upload)
- Location sharing with an embedded map
- Reactions on messages
- Push notifications (Web Push API)
- Export/import of account data (JSON dump)
- Multiple devices per account
- Conversation pinning and archiving
- Lazy message loading
- Multi-language interface (English, Greek, Russian)

### What is not implemented yet

- Mesh networking (Hub and Root layers)
- Channels / broadcast feeds
- Message deletion requests
- Server-side file encryption verification

## Quick start

```bash
cd server
cp example.env .env
npm install
node spot.js
```

Open `http://localhost:8080` in your browser.

On first run, the server will generate JWT and VAPID keys automatically and write them to `.env`.

For production, put nginx in front as a reverse proxy with SSL termination. See `example.env` for all configuration options including S3 storage for file transfers.

## Project structure

```
client/             PWA frontend (static files)
  js/               application modules
  css/              stylesheets
  locales/          translation files
  icons/            app icons

server/             Node.js backend
  spot.js           Spot entry point
  src/spot/         Spot modules (auth, contacts, db, files, push, send, receive, ws)
  src/shared/       shared code (reserved for future use)
  src/hub/          Hub modules (not implemented)
  hub.js            Hub entry point (stub)
  root.js           Root entry point (stub)
```

## Security notes

- All message content is encrypted client-side. The server only sees encrypted payloads.
- RSA-2048 key pairs are generated in the browser using Web Crypto API.
- Each message is signed with RSA-PSS to verify the sender.
- Group chats use a shared AES-256-GCM key distributed through encrypted invites.
- Files are encrypted with a per-file AES key before upload to S3. The server never sees plaintext files.
- The server authenticates clients using JWT tokens issued during a challenge-response registration.
- Contact data stored on the server is encrypted with the user's own public key.

This is a hobby project and has not been audited. Use at your own risk.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
