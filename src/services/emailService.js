import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from './firebase.js'

const sendLoanReminderCall = httpsCallable(
  getFunctions(firebaseApp, 'us-central1'),
  'sendLoanReminder',
)

export async function sendLoanReminder(loanId) {
  const response = await sendLoanReminderCall({ loanId })
  return response.data
}
