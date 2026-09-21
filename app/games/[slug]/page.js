'use client'
import { notFound } from 'next/navigation'
import useGameData from './useGameData'
import GameDisabledNotice from './GameDisabledNotice'
import { useGames } from '../../../components/GameSettingsProvider'
import DetailSheet from './DetailSheet'
import PaymentModal from './PaymentModal'
import { LAYOUTS, DefaultLayout } from './layouts'

export default function GameDetail() {
  const data = useGameData()
  const { loaded, getGameStatus } = useGames()
  const Layout = LAYOUTS[data.slug] || DefaultLayout

  // Admin controls (dashboard → Games): hidden / deleted games don't exist,
  // temporarily disabled games show a notice until they come back.
  const status = getGameStatus(data.slug)
  if (!loaded) return null
  if (status.state === 'hidden' || status.state === 'deleted') notFound()
  if (status.state === 'disabled') return <GameDisabledNotice game={data.game} status={status} />

  return (
    <>
      <Layout data={data} />

      <DetailSheet
        selected={data.selected}
        onClose={() => data.setSelected(null)}
        isJoined={data.isJoined}
        isFull={data.isFull}
        selectedHasFee={data.selectedHasFee}
        selectedPending={data.selectedPending}
        onPay={() => { data.setPayModal(data.selected); data.setSelected(null) }}
        onRegister={() => data.registerTournament(data.selected)}
      />

      {data.payModal && (
        <PaymentModal
          tournament={data.payModal}
          user={data.user}
          onClose={() => data.setPayModal(null)}
          onSubmitted={data.onPaymentSubmitted}
        />
      )}
    </>
  )
}
