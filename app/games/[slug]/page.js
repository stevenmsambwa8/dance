'use client'
import useGameData from './useGameData'
import DetailSheet from './DetailSheet'
import PaymentModal from './PaymentModal'
import { LAYOUTS, DefaultLayout } from './layouts'

export default function GameDetail() {
  const data = useGameData()
  const Layout = LAYOUTS[data.slug] || DefaultLayout

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
