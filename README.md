# Figma MCP

A Figma MCP server based on Figma's RESTful API.

Configuration:
Use `.env.template` template to configure parameters.

Suppose you have a configuration file `.env`

Optional (for using MongoDB as the caching backend): Run the mongod (You can use docker for simplicity):
`docker run -d -p 27017:27017 --name my-mongo-container mongo:latest`

So the `MONGODB_URI` in the `.env` file should be set to `mongodb://127.0.0.1:27017`

Run the server with npx command:
`npx github:VincentHanxiaoDu/figma-mcp --env .env --port 3000`

Connect to Claude Code (Replace `<your-figma-token>` with your Figma token):
`claude mcp add -t http figma-mcp http://127.0.0.1:3000/mcp --header x-figma-token:<your-figma-token>`, or set the `FIGMA_TOKEN` in the env file and run just `claude mcp add -t http figma-mcp http://127.0.0.1:3000/mcp`.

Now you can use the MCP in Claude Code.
