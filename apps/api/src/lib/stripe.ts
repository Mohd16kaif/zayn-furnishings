import Stripe from "stripe";
import { env } from "../config/env";

export const STRIPE_API_VERSION = "2024-06-20";

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;
