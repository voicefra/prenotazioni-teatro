/**
 * Dichiarazione fiscale mostrata in fondo alle pagine, nelle email e nei PDF.
 * Testo fornito dall'organizzazione: modificarlo solo su sua richiesta.
 */

/** Spettacoli con pagamento online (Stripe). */
export const FISCAL_DISCLAIMER =
  "Si tiene a precisare che il suddetto portale web che viene utilizzato non opera come Sistema di Biglietteria Automatizzata ai sensi del Provvedimento Agenzia Entrate del 23/07/2001, in quanto non emette alcun Titolo di Accesso fiscale. Il portale è un mero strumento di e-commerce per la prenotazione e il pagamento anticipato. L'assolvimento degli obblighi fiscali e del diritto d'autore per l'accesso allo spettacolo avverrà tramite l'emissione di regolari Titoli di Accesso fiscali premarcati SIAE, che avverrà direttamente in biglietteria, il giorno dello spettacolo, presentando al personale addetto, il voucher di prenotazione che verrà inviato sulla mail. Gli incassi verranno quindi regolarmente rendicontati tramite Modello C1."

/** Spettacoli "solo prenotazione": biglietto SIAE da ritirare e pagare entro 48 ore. */
export const FISCAL_DISCLAIMER_SOLO_PRENOTAZIONE =
  "Si tiene a precisare che il suddetto portale web che viene utilizzato non opera come Sistema di Biglietteria Automatizzata ai sensi del Provvedimento Agenzia Entrate del 23/07/2001, in quanto non emette alcun Titolo di Accesso fiscale. Il portale è un mero strumento per la prenotazione dei posti. L'assolvimento degli obblighi fiscali e del diritto d'autore per l'accesso allo spettacolo avverrà tramite l'emissione di regolari Titoli di Accesso fiscali premarcati SIAE, che dovranno essere ritirati e pagati, entro 48 ore dalla prenotazione online, presso un punto vendita autorizzato o presso la sede dell'organizzatore. Solo dopo il pagamento verrà inviato sulla mail il voucher di prenotazione con QR code, da presentare al personale addetto all'ingresso. Gli incassi verranno quindi regolarmente rendicontati tramite Modello C1."

/** Nota aggiuntiva per l'elenco spettacoli, dove compaiono entrambe le modalità. */
export const FISCAL_NOTE_SOLO_PRENOTAZIONE =
  "Per gli spettacoli che prevedono la sola prenotazione online, senza pagamento sul portale, i Titoli di Accesso fiscali premarcati SIAE dovranno essere ritirati e pagati entro 48 ore dalla prenotazione presso un punto vendita autorizzato o presso la sede dell'organizzatore."

export function fiscalDisclaimerFor(soloPrenotazione: boolean): string {
  return soloPrenotazione ? FISCAL_DISCLAIMER_SOLO_PRENOTAZIONE : FISCAL_DISCLAIMER
}
