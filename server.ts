import dotenv from "dotenv";
import { createApp } from "./server/app.js";

dotenv.config();

async function startServer() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn("STRIPE_SECRET_KEY is missing. Payment features will return 503 until configured.");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn("STRIPE_WEBHOOK_SECRET is missing. Stripe webhook verification will return 503 until configured.");
  }

  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
