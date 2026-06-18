// MCP server exposing Escrow402 to buyer agents.
// Tools:
//   pay_safely  — pay a seller's x402 endpoint through escrow; auto-refund on bad delivery.
//   trust_score — read a seller's on-chain settlement reputation BEFORE paying.
// Run: npm run mcp   (uses MockEscrowClient until Testnet deploy)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { paySafely } from "./pay-safely.ts";
import { httpSeller } from "./http-seller.ts";
import { selectEscrowClient } from "./select-client.ts";
import type { EscrowClient } from "./escrow.ts";

export function buildMcpServer(client: EscrowClient): McpServer {
  const server = new McpServer({ name: "escrow402", version: "0.1.0" });

  server.registerTool(
    "pay_safely",
    {
      title: "Pay a seller through escrow",
      description:
        "Pay a seller's x402 endpoint via Escrow402. Funds are escrowed on Casper, the seller's " +
        "response is verified, and the escrow only releases on valid delivery — otherwise you are " +
        "auto-refunded. Returns released=true/false, the response, and the seller's reputation.",
      inputSchema: {
        sellerUrl: z.string().url().describe("Seller's x402 endpoint"),
        payer: z.string().describe("Payer (your) Casper address"),
        payee: z.string().describe("Payee (seller) Casper address"),
        amountMotes: z.string().regex(/^\d+$/).describe("Escrow amount in motes"),
        request: z.unknown().optional().describe("Request payload for the seller"),
        requiredFields: z.array(z.string()).optional().describe("Fields the response must contain"),
        maxAgeMs: z.number().positive().optional().describe("Max acceptable data age (ms)"),
      },
    },
    async (args) => {
      const result = await paySafely({
        client,
        payer: args.payer,
        payee: args.payee,
        amountMotes: args.amountMotes,
        request: args.request ?? {},
        seller: httpSeller(args.sellerUrl),
        expectations: { requiredFields: args.requiredFields, maxAgeMs: args.maxAgeMs },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "trust_score",
    {
      title: "Seller reputation",
      description: "Read a seller's on-chain Escrow402 settlement reputation before paying.",
      inputSchema: { address: z.string().describe("Seller Casper address") },
    },
    async (args) => {
      const rep = await client.reputationOf(args.address);
      return {
        content: [{ type: "text", text: JSON.stringify(rep, null, 2) }],
        structuredContent: rep as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildMcpServer(selectEscrowClient());
  await server.connect(new StdioServerTransport());
  console.error("Escrow402 MCP server connected on stdio");
}
