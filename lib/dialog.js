// Drop-in replacements for window.alert / window.confirm that render the
// app's own dialog (components/DialogHost.js) instead of the browser's.
//
//   showAlert('Saved')                       // fire and forget
//   if (!(await confirmDialog('Delete?'))) return
//
// Falls back to the native dialogs during SSR or if the host isn't mounted.
let listener = null

export function registerDialogHost(fn) {
  listener = fn
  return () => { if (listener === fn) listener = null }
}

export function showAlert(message, opts = {}) {
  const text = message instanceof Error ? message.message : String(message ?? '')
  if (!listener) {
    if (typeof window !== 'undefined') window.alert(text)
    return Promise.resolve()
  }
  return new Promise((resolve) => listener({ type: 'alert', message: text, ...opts, resolve }))
}

export function confirmDialog(message, opts = {}) {
  const text = String(message ?? '')
  if (!listener) {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(text) : false)
  }
  return new Promise((resolve) => listener({ type: 'confirm', message: text, ...opts, resolve }))
}
