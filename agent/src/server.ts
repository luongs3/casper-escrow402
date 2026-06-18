// HTTP surface for Escrow402.
//   POST /pay-safely  { sellerUrl, payer, payee, amountMotes, request?, requiredFields?, maxAgeMs? }
//   GET  /trust/:address
// Run: npm run serve   (MockEscrowClient until Testnet deploy)

import express from "express";
import { paySafely } from "./pay-safely.ts";
import { httpSeller } from "./http-seller.ts";
import { selectEscrowClient } from "./select-client.ts";
import type { EscrowClient } from "./escrow.ts";

export function createApp(client: EscrowClient) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "escrow402", version: "0.1.0" }));

  app.get("/trust/:address", async (req, res) => {
    res.json(await client.reputationOf(req.params.address));
  });

  app.post("/pay-safely", async (req, res) => {
    const b = req.body ?? {};
    if (!b.sellerUrl || !b.payer || !b.payee || !/^\d+$/.test(String(b.amountMotes ?? ""))) {
      res.status(400).json({ error: "need { sellerUrl, payer, payee, amountMotes(digits) }" });
      return;
    }
    try {
      const result = await paySafely({
        client,
        payer: b.payer,
        payee: b.payee,
        amountMotes: String(b.amountMotes),
        request: b.request ?? {},
        seller: httpSeller(b.sellerUrl),
        expectations: { requiredFields: b.requiredFields, maxAgeMs: b.maxAgeMs },
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8402);
  createApp(selectEscrowClient()).listen(port, () =>
    console.log(`Escrow402 server on :${port}`),
  );
}
