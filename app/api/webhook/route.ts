import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2026-03-25.dahlia",
});

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature") as string;

  let event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    
    // Qui andiamo su Supabase e cambiamo lo stato dei posti da 'bloccato' a 'occupato'
    // Per farlo, avremmo bisogno di sapere QUALI posti erano stati bloccati.
    // (Per questo motivo, nella Fase 6 ti insegnerò come salvare i dati dell'utente su Supabase PRIMA di pagare)
  }

  return NextResponse.json({ received: true });
}