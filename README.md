# Washington County CDC Code Language Tool

A self-contained web application that lets **administrators** upload Washington County's Community Development Code (CDC), Road Design and Construction Standards (RDCS), and Transportation System Plan (TSP), and lets **public users** generate development requirements outlines with the full applicable code language — pulled directly from those uploaded source documents.

## How It Works

- **Admins** log in, upload the latest CDC/RDCS/TSP PDFs, and tag each document with its topic (district standards, parking, landscaping, etc.).
- **Public users** select a proposed use, land use district, and road classification. The tool sends the relevant uploaded documents to the AI, which extracts and returns the exact applicable code language.
- Every outline identifies which source documents were used and when they were uploaded — so users always know how current the information is.

## Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- An [Anthropic API key](https://console.anthropic.com/)

### 2. Install
```bash
git clone <this-repo>
cd wc-cdc-tool
npm install
```

### 3. Configure
Copy the example environment file and fill in your values:
```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...        # Your Anthropic API key
ADMIN_PASSWORD=your-secure-password  # Password for the admin panel
PORT=3000                            # Port to run on (default 3000)
```

### 4. Run
```bash
npm start
```

The app will be available at `http://localhost:3000`.

- Public tool: `http://localhost:3000`
- Admin panel: `http://localhost:3000/admin.html`

## Deployment

### Option A: Any Node.js host (DigitalOcean, AWS EC2, Azure, etc.)
1. Clone the repo on the server
2. Run `npm install --production`
3. Set environment variables
4. Run with `pm2 start server.js` (or your process manager of choice)

### Option B: Docker
```bash
docker build -t wc-cdc-tool .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e ADMIN_PASSWORD=your-password \
  -v ./data:/app/data \
  wc-cdc-tool
```

### Option C: County website integration
The app can be embedded in an existing county website via:
- **Subdomain**: `cdc-tool.washingtoncountyor.gov`
- **Reverse proxy**: Add a location block in nginx/Apache pointing to the Node.js app
- **iframe**: Embed the public page in an existing page (not recommended for accessibility)

## File Structure
```
wc-cdc-tool/
├── server.js           # Express backend (API routes, admin auth, file handling)
├── public/
│   ├── index.html      # Public user interface
│   └── admin.html      # Admin document management panel
├── data/
│   ├── documents.json  # Document metadata (auto-created)
│   └── uploads/        # Uploaded PDF storage
├── .env.example        # Environment variable template
├── package.json
├── Dockerfile
└── README.md
```

## Maintenance

The only ongoing maintenance is:
1. **When the CDC is amended**: Admin uploads the new version of affected sections and removes the old ones.
2. **API key renewal**: If the Anthropic API key expires, update it in `.env` and restart.

No code changes are needed for document updates — the tool reads whatever has been uploaded.
