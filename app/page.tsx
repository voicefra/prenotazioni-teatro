import { redirect } from "next/navigation"
import { TheaterBooking } from "@/components/theater/theater-booking"

interface HomePageProps {
  searchParams: Promise<{ replica_id?: string }>
}

export default async function Home({ searchParams }: HomePageProps) {
  const params = await searchParams
  const replicaId = params?.replica_id

  if (!replicaId) {
    redirect("/spettacoli")
  }

  return <TheaterBooking key={`booking-replica-${replicaId}`} />
}
