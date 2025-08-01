# Figma MCP

A Figma MCP server based on Figma's RESTful API.

Configuration:

Install the required dependencies.
```
git clone https://github.com/VincentHanxiaoDu/figma-mcp
cd figma-mcp --legacy-peer-deps
```

Configure the .env file for Mongo/Azure AI setup (you can always change the embedding method by implementing the `EmbeddingsInterface` interface provided by `@langchain/core/embeddings`, and change the embeddings impl in the `query-figma-file-node` tool defined in the `index.ts`, i.e., `const embeddings = new <Your Embeddings Impl>`)

Configure the .env file with template:
`cp .env.template .env`
Then edit the .env file as you need.

To enable caching of files and embeddings, make sure a mongod instance is running.

Build & start the server with the npm start script:
```
npm run build
npm run start
```

Or debug with the dev script
```
npm run dev
```

Configure with Claude Code, replace `<your-figma-token>` with your actual Figma API token:
`claude mcp add -t http figma-mcp http://localhost:3000/mcp --header x-figma-token:<your-figma-token>`

Or you can set the `FIGMA_TOKEN` env variable in the .env file:
```
FIGMA_TOKEN=<your-figma-token>
...
```