import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({ name: 'intellmeet-design-research', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL('https://inspomcp.dev/api/mcp'));
try {
  await client.connect(transport);
  if (process.argv[2]) {
    const result = await client.callTool({
      name: process.argv[2],
      arguments: JSON.parse(process.argv[3] || '{}'),
    });
    console.log(
      result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n'),
    );
  } else
    console.log(
      JSON.stringify(
        (await client.listTools()).tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })),
      ),
    );
} finally {
  await client.close();
  await transport.close();
}
