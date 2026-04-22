"use server"

import QRCode from "qrcode"
import { buffer as streamConsumersBuffer } from "node:stream/consumers"
import { Readable } from "node:stream"
import React from "react"
import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer"

export type TicketSeat = {
  fila: string
  posto: string
}

export type TicketPdfInput = {
  spettacolo: string
  enteOrganizzatore?: string
  teatroNome?: string
  teatroIndirizzo?: string
  teatroComune?: string
  teatroTelefono?: string
  data: string
  orario: string
  seats: TicketSeat[]
  prezzoBiglietto?: number
  dirittiPrevendita?: number
  /** URL completo nel QR (es. https://localhost:3000/scan?ticket_id=<uuid prenotazione>) */
  ticketScanUrl: string
}

const styles = StyleSheet.create({
  page: {
    padding: 26,
    fontSize: 12,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: "1px solid #e5e7eb",
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: "#0f172a",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: "#444",
  },
  sectionTitle: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: 700,
    color: "#0f172a",
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 18,
    backgroundColor: "#f8fafc",
  },
  details: {
    flexGrow: 1,
    gap: 7,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  label: {
    width: 84,
    color: "#6b7280",
  },
  value: {
    color: "#111827",
    fontWeight: 700,
  },
  table: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderBottom: "1px solid #e5e7eb",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #e5e7eb",
  },
  colSeat: {
    width: "34%",
    padding: 6,
    fontSize: 10,
  },
  colRow: {
    width: "22%",
    padding: 6,
    fontSize: 10,
  },
  colPrice: {
    width: "22%",
    padding: 6,
    fontSize: 10,
    textAlign: "right",
  },
  colPrev: {
    width: "22%",
    padding: 6,
    fontSize: 10,
    textAlign: "right",
  },
  qrWrap: {
    width: 180,
    alignItems: "center",
    justifyContent: "center",
    borderLeft: "1px solid #f3f4f6",
    paddingLeft: 16,
  },
  qr: {
    width: 160,
    height: 160,
  },
  qrCaption: {
    marginTop: 6,
    fontSize: 9,
    color: "#6b7280",
  },
  footer: {
    marginTop: 18,
    fontSize: 8,
    color: "#6b7280",
    lineHeight: 1.35,
    borderTop: "1px solid #e5e7eb",
    paddingTop: 10,
  },
})

async function seatQrDataUrl(qrPayload: string): Promise<string> {
  return QRCode.toDataURL(qrPayload, {
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  })
}

function TicketPage({
  spettacolo,
  data,
  orario,
  enteOrganizzatore,
  teatroNome,
  teatroIndirizzo,
  teatroComune,
  teatroTelefono,
  prezzoBiglietto,
  dirittiPrevendita,
  seat,
  qrDataUrl,
}: {
  spettacolo: string
  data: string
  orario: string
  enteOrganizzatore?: string
  teatroNome?: string
  teatroIndirizzo?: string
  teatroComune?: string
  teatroTelefono?: string
  prezzoBiglietto?: number
  dirittiPrevendita?: number
  seat: TicketSeat
  qrDataUrl: string
}) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>{spettacolo}</Text>
        <Text style={styles.subtitle}>Organizzato da: {enteOrganizzatore || "Dati non disponibili"}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.details}>
          <Text style={styles.sectionTitle}>Dettagli evento</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Teatro</Text>
            <Text style={styles.value}>{teatroNome || "Dati non disponibili"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Indirizzo</Text>
            <Text style={styles.value}>
              {teatroIndirizzo || "Dati non disponibili"}, {teatroComune || "Dati non disponibili"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Telefono</Text>
            <Text style={styles.value}>{teatroTelefono || "Dati non disponibili"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Data</Text>
            <Text style={styles.value}>{data}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Orario</Text>
            <Text style={styles.value}>{orario}</Text>
          </View>
          <Text style={styles.sectionTitle}>Riepilogo posti acquistati</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colSeat}>Posto</Text>
              <Text style={styles.colRow}>Fila</Text>
              <Text style={styles.colPrice}>Prezzo</Text>
              <Text style={styles.colPrev}>Prev.</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={styles.colSeat}>{seat.fila + seat.posto}</Text>
              <Text style={styles.colRow}>{seat.fila}</Text>
              <Text style={styles.colPrice}>€ {(prezzoBiglietto ?? 0).toFixed(2)}</Text>
              <Text style={styles.colPrev}>€ {(dirittiPrevendita ?? 0).toFixed(2)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.qrWrap}>
          <Image style={styles.qr} src={qrDataUrl} />
          <Text style={styles.qrCaption}>QR Code valido per il controllo accessi</Text>
        </View>
      </View>

      <Text style={styles.footer}>
        NOTE LEGALI: L'Organizzatore effettua la vendita dei Titoli di Ingresso in nome e per conto di se stesso. Il
        contratto relativo all’acquisto dei Titoli di Ingresso si intende pertanto concluso direttamente tra il Cliente
        e l’Organizzatore. La nostra Associazione agisce esclusivamente come intermediario tecnologico per la gestione
        della piattaforma di prenotazione.
      </Text>
      <Text style={styles.footer}>
        TERMINI E CONDIZIONI: Si informa il gentile pubblico che, ai sensi dell’art. 59, lett. n) del D.Lgs. 206/2005
        (Codice del Consumo), il diritto di recesso non si applica ai contratti riguardanti la fornitura di servizi
        relativi al tempo libero, qualora il contratto preveda una data o un periodo di esecuzione specifici. Pertanto,
        una volta acquistato, il Titolo di Ingresso non è rimborsabile. L'Organizzatore si riserva il diritto di
        apportare modifiche al programma per cause di forza maggiore.
      </Text>
      <Text style={styles.footer}>
        TRATTAMENTO DATI PERSONALI (Informativa Privacy): I dati personali raccolti tramite questa piattaforma sono
        trattati dall'Organizzatore in qualità di Titolare del trattamento, nel pieno rispetto del Regolamento UE
        2016/679 (GDPR). I dati sono raccolti esclusivamente per finalità legate alla gestione della prenotazione,
        all'invio del Titolo di Ingresso e agli obblighi contabili/fiscali previsti dalla legge. I dati non saranno
        ceduti a terzi. L'interessato può esercitare in ogni momento i propri diritti (accesso, rettifica,
        cancellazione) contattando l'Organizzatore all'indirizzo email indicato in fattura o sul sito.
      </Text>
    </Page>
  )
}

export async function renderTicketsPdf(input: TicketPdfInput): Promise<Buffer> {
  const scanUrl = String(input.ticketScanUrl ?? "").trim()
  if (!scanUrl) {
    throw new Error("ticketScanUrl mancante per la generazione del QR.")
  }

  const sharedQrDataUrl = await seatQrDataUrl(scanUrl)
  const qrBySeat = input.seats.map((seat) => ({ seat, qrDataUrl: sharedQrDataUrl }))

  const doc = (
    <Document>
      {qrBySeat.map(({ seat, qrDataUrl }) => (
        <TicketPage
          key={`${seat.fila}-${seat.posto}`}
          spettacolo={input.spettacolo}
          enteOrganizzatore={input.enteOrganizzatore}
          teatroNome={input.teatroNome}
          teatroIndirizzo={input.teatroIndirizzo}
          teatroComune={input.teatroComune}
          teatroTelefono={input.teatroTelefono}
          data={input.data}
          orario={input.orario}
          prezzoBiglietto={input.prezzoBiglietto}
          dirittiPrevendita={input.dirittiPrevendita}
          seat={seat}
          qrDataUrl={qrDataUrl}
        />
      ))}
    </Document>
  )

  const out = await pdf(doc).toBuffer()
  if (Buffer.isBuffer(out)) return out
  if (out instanceof Uint8Array) return Buffer.from(out)
  if (out instanceof ArrayBuffer) return Buffer.from(out)
  if (typeof Blob !== "undefined" && out instanceof Blob) {
    const ab = await out.arrayBuffer()
    return Buffer.from(ab)
  }
  if (Readable.isReadable(out)) {
    return await streamConsumersBuffer(out)
  }
  if (isWebReadableStream(out)) {
    return await readableWebStreamToBuffer(out)
  }
  throw new Error(`Output PDF in formato non supportato: ${Object.prototype.toString.call(out)}`)
}

function isWebReadableStream(x: unknown): x is ReadableStream {
  return (
    typeof x === "object" &&
    x !== null &&
    "getReader" in x &&
    typeof (x as ReadableStream).getReader === "function"
  )
}

async function readableWebStreamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const size = chunks.reduce((acc, c) => acc + c.byteLength, 0)
  const merged = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return Buffer.from(merged)
}

