# Figma MCP

A Figma MCP server based on Figma's RESTful API.

## Basic Configurations:
Use `.env.template` template to configure parameters.

Suppose you have a configuration file `.env`


Run with docker compose:
`docker compose up -d`

Run manually:

Optional (for using MongoDB as the caching backend): Run the mongod (You can use docker for simplicity):
`docker run -d -p 27017:27017 --name my-mongo-container mongo:latest`

So the `MONGODB_URI` in the `.env` file should be set to `mongodb://127.0.0.1:27017`

Run the server with npx command:
`npx github:VincentHanxiaoDu/figma-mcp --env .env --port 3000`

Connect to Claude Code (Replace `<your-figma-token>` with your Figma token):
`claude mcp add -t http figma-mcp http://127.0.0.1:3000/mcp --header x-figma-token:<your-figma-token>`, or set the `FIGMA_TOKEN` in the env file and run just `claude mcp add -t http figma-mcp http://127.0.0.1:3000/mcp`.

Now you can use the MCP in Claude Code.

## Advanced Configurations:
Use your account info (for now, only Azure accounts are supported) to find files automatically in the workspaces.

### Option 1: Configure credentials with `.env`
Set `FIGMA_USERNAME` and `FIGMA_PASSWORD_B64` in the `.env` file.

### Option 2: Configure credentials with headers
Pass `x-figma-username` and `x-figma-passwords-b64` headers for the mcp tool calls.

### Option 3: Configure cookies with `.env`
Set `FIGMA_COOKIES` in the `.env` file, you can either manually copy and paste the cookies after logging in to Figma or get the cookies using the tool `npx github:VincentHanxiaoDu/figma-mcp --tool `

### Option 4: Configure cookies with headers
Pass `x-figma-cookies` headers for the mcp tool calls.

# ENV VAR Table
| ENV VAR            | ARGS                    | HEADER                     |
|--------------------|-------------------------|----------------------------|
| HOST               | --host                  | <N/A>                      |
| PORT               | --port                  | <N/A>                      |
| FIGMA_TOKEN        | --figma-token           | x-figma-token              |
| FIGMA_USERNAME     | --figma-username        | x-figma-username           |
| FIGMA_PASSWORD_B64 | --figma-password-b64    | x-figma-password-b64       |
| FIGMA_COOKIES      | --figma-cookies         | x-figma-cookies            |

**Note:**  
- You can set credentials via environment variables, command-line arguments, or HTTP headers.


This project includes portions of code from:

- Figma-Context-MCP (https://github.com/GLips/Figma-Context-MCP)
  Copyright (c) 2025 Graham Lipsman
  Licensed under the MIT License
