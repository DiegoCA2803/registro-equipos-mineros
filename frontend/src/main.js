const equipmentBody = document.querySelector('#equipment')
const message = document.querySelector('#message')
const notice = document.querySelector('#notice')
const reload = document.querySelector('#reload')
const addEquipment = document.querySelector('#add-equipment')
const editor = document.querySelector('#equipment-editor')
const editorTitle = document.querySelector('#editor-title')
const equipmentForm = document.querySelector('#equipment-form')
const editorError = equipmentForm.querySelector('.form-error')
const code = document.querySelector('#code')
const type = document.querySelector('#type')
const hourMeter = document.querySelector('#hours')
const removal = document.querySelector('#equipment-removal')
const removalCode = document.querySelector('#removal-code')
const removalForm = document.querySelector('#removal-form')
const maintenanceDialog = document.querySelector('#equipment-maintenance')
const maintenanceForm = document.querySelector('#maintenance-form')
const maintenanceCode = document.querySelector('#maintenance-code')
const maintenanceTotal = document.querySelector('#maintenance-total')
const maintenanceCycle = document.querySelector('#maintenance-cycle')
const historyStatus = document.querySelector('#maintenance-history-status')
const historyList = document.querySelector('#maintenance-history')
const register = document.querySelector('#register-maintenance')
const loginPanel = document.querySelector('#login-panel')
const loginForm = document.querySelector('#login-form')
const loginError = loginForm.querySelector('.form-error')
const loginSubmit = loginForm.querySelector('[type="submit"]')
const loginUser = document.querySelector('#login-username')
const loginPassword = document.querySelector('#login-password')
const inventory = document.querySelector('#inventory-panel')
const logout = document.querySelector('#logout')

const apiBase = import.meta.env.API_BASE_URL
const equipmentUrl = apiBase + '/api/equipos'
const sessionKey = 'registro-equipos.jwt'
const typeLabels = new Map(Array.from(type.options, (option) => [option.value, option.textContent]))
const hours = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
const serviceDate = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' })
let editing = null
let removing = null
let servicing = null
let historyRequest = 0
let session = sessionStorage.getItem(sessionKey)

function openInventory() {
  loginForm.reset()
  loginError.textContent = ''
  loginPanel.hidden = true
  inventory.hidden = false
  logout.hidden = false
  loadEquipment()
}

function closeSession(messageText = '') {
  sessionStorage.removeItem(sessionKey)
  session = null
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close()
  equipmentBody.replaceChildren()
  notice.textContent = ''
  inventory.hidden = true
  logout.hidden = true
  loginForm.reset()
  loginPanel.hidden = false
  loginError.textContent = messageText
  loginUser.focus()
}

function formatHours(value) {
  return hours.format(value) + ' h'
}

async function requestEquipment(path = '', { method = 'GET', body } = {}) {
  const token = session
  let response
  try {
    response = await fetch(equipmentUrl + path, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new Error('No se pudo confirmar la operación. Actualiza el inventario antes de reintentar.')
  }

  if (response.status === 401 && session === token) {
    closeSession('Tu sesión ya no es válida. Vuelve a iniciar sesión.')
  }
  if (response.status === 204) return null
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    const reason = typeof data?.error === 'string' ? data.error : 'La API no pudo completar la operación. Inténtalo de nuevo.'
    throw new Error(reason)
  }
  return data
}

function openEditor(equipment = null) {
  editing = equipment
  equipmentForm.reset()
  editorTitle.textContent = equipment ? 'Editar equipo' : 'Nuevo equipo'
  equipmentForm.querySelector('[type="submit"]').textContent = equipment ? 'Guardar cambios' : 'Crear equipo'
  editorError.textContent = ''
  code.value = equipment?.codigo ?? ''
  type.value = equipment?.tipo ?? ''
  hourMeter.value = equipment?.horometro ?? ''
  editor.showModal()
  code.focus()
}

function openRemoval(equipment) {
  removing = equipment
  removalCode.textContent = equipment.codigo
  removalForm.querySelector('.form-error').textContent = ''
  removal.showModal()
}

async function openMaintenance(equipment) {
  servicing = equipment
  const request = ++historyRequest
  maintenanceCode.textContent = equipment.codigo
  maintenanceTotal.textContent = formatHours(equipment.horometro)
  const { horasDesdeUltimo, intervalo } = equipment.mantenimiento
  maintenanceCycle.textContent = `${formatHours(horasDesdeUltimo)} de ${formatHours(intervalo)}`
  maintenanceForm.querySelector('.form-error').textContent = ''
  historyList.replaceChildren()
  historyStatus.textContent = 'Cargando historial…'
  register.disabled = true
  maintenanceDialog.showModal()

  try {
    const { mantenimientos } = await requestEquipment(`/${equipment.id}/mantenimientos`)
    if (!maintenanceDialog.open || request !== historyRequest) return
    for (const entry of mantenimientos) {
      const item = document.createElement('li')
      const date = document.createElement('time')
      date.dateTime = entry.fecha
      date.textContent = serviceDate.format(new Date(entry.fecha))
      const reading = document.createElement('strong')
      reading.textContent = formatHours(entry.horometro)
      item.append(date, reading)
      historyList.append(item)
    }
    register.disabled = mantenimientos[0]?.horometro === equipment.horometro
    historyStatus.textContent = register.disabled
      ? 'Ya hay un mantenimiento registrado con esta lectura.'
      : mantenimientos.length ? '' : 'Aún no hay mantenimientos registrados.'
  } catch {
    if (!maintenanceDialog.open || request !== historyRequest) return
    historyStatus.textContent = 'No se pudo cargar el historial. Cierra esta ventana y vuelve a abrirla para reintentar.'
    register.disabled = false
  }
}

function equipmentRow(equipment) {
  const row = document.createElement('tr')
  row.setAttribute('role', 'row')
  row.dataset.equipmentId = equipment.id
  const values = [equipment.codigo, typeLabels.get(equipment.tipo) ?? equipment.tipo, formatHours(equipment.horometro)]
  for (const value of values) {
    const cell = row.insertCell()
    cell.setAttribute('role', 'cell')
    cell.textContent = value
  }
  row.cells[2].className = 'hours'

  const state = row.insertCell()
  state.className = 'equipment-state'
  state.setAttribute('role', 'cell')
  const badge = document.createElement('span')
  badge.className = equipment.mantenimiento.requiere ? 'status-badge due' : 'status-badge'
  badge.textContent = equipment.mantenimiento.requiere ? 'Requiere mantenimiento' : 'Al día'
  state.append(badge)

  const actions = row.insertCell()
  actions.className = 'row-actions'
  actions.setAttribute('role', 'cell')
  const buttons = document.createElement('div')
  buttons.className = 'row-buttons'
  for (const [label, open] of [['Mantenimiento', openMaintenance], ['Editar', openEditor], ['Eliminar', openRemoval]]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = open === openRemoval ? 'row-button row-danger' : 'row-button'
    button.textContent = label
    const subject = open === openMaintenance ? ' de ' : ' '
    button.setAttribute('aria-label', label + subject + equipment.codigo)
    button.addEventListener('click', () => open(equipment))
    buttons.append(button)
  }
  actions.append(buttons)
  return row
}

async function loadEquipment() {
  const token = session
  reload.disabled = true
  addEquipment.disabled = true
  reload.textContent = 'Actualizar'
  equipmentBody.replaceChildren()
  message.className = ''
  message.textContent = 'Cargando equipos…'

  try {
    const { equipos } = await requestEquipment()
    if (session !== token) return
    const rows = document.createDocumentFragment()
    for (const equipment of equipos) rows.append(equipmentRow(equipment))
    equipmentBody.replaceChildren(rows)
    message.textContent = equipos.length ? '' : 'Aún no hay equipos registrados.'
  } catch {
    if (session !== token) return
    message.className = 'error'
    message.textContent = 'No se pudo consultar el inventario. Comprueba la conexión y vuelve a intentarlo.'
    reload.textContent = 'Reintentar'
  } finally {
    if (session === token) {
      reload.disabled = false
      addEquipment.disabled = false
    }
  }
}

async function submitChange(form, progress, change) {
  const dialog = form.closest('dialog')
  const fieldset = form.querySelector('fieldset')
  const errorMessage = form.querySelector('.form-error')
  const submit = form.querySelector('[type="submit"]')
  if (fieldset.disabled) return

  const label = submit.textContent
  const trigger = document.activeElement
  fieldset.disabled = true
  submit.textContent = progress
  errorMessage.textContent = ''
  let result
  try {
    result = await change()
  } catch (error) {
    errorMessage.textContent = error.message
  } finally {
    fieldset.disabled = false
    submit.textContent = label
  }
  if (!result) {
    trigger?.focus()
    return
  }

  dialog.close()
  notice.textContent = result.message
  await loadEquipment()
  if (document.activeElement === document.body) {
    const updated = equipmentBody.querySelector(`[data-equipment-id="${result.id}"] button`)
    const focusTarget = updated ?? addEquipment
    focusTarget.focus()
  }
}

equipmentForm.addEventListener('input', () => {
  editorError.textContent = ''
})
equipmentForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const values = { codigo: code.value.trim(), tipo: type.value, horometro: hourMeter.valueAsNumber }
  const original = editing
  if (original) {
    for (const key of Object.keys(values)) {
      if (values[key] === original[key]) delete values[key]
    }
    if (Object.keys(values).length === 0) {
      editorError.textContent = 'Cambia al menos un campo antes de guardar.'
      return
    }
  }

  submitChange(equipmentForm, 'Guardando…', async () => {
    const { equipo } = await requestEquipment(original ? `/${original.id}` : '', {
      method: original ? 'PATCH' : 'POST',
      body: values,
    })
    return { id: equipo.id, message: original ? 'Cambios guardados.' : 'Equipo creado.' }
  })
})

removalForm.addEventListener('submit', (event) => {
  event.preventDefault()
  submitChange(removalForm, 'Eliminando…', async () => {
    await requestEquipment(`/${removing.id}`, { method: 'DELETE' })
    return { message: 'Equipo eliminado.' }
  })
})

maintenanceForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (register.disabled) return
  const { id, horometro } = servicing
  submitChange(maintenanceForm, 'Registrando…', async () => {
    await requestEquipment(`/${id}/mantenimientos`, { method: 'POST', body: { horometro } })
    return { id, message: 'Mantenimiento registrado.' }
  })
})

for (const dialog of [editor, removal, maintenanceDialog]) {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => {
    if (dialog.querySelector('fieldset').disabled) event.preventDefault()
  })
}

addEquipment.addEventListener('click', () => openEditor())
reload.addEventListener('click', () => {
  notice.textContent = ''
  loadEquipment()
})
logout.addEventListener('click', () => closeSession())
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const fields = loginForm.querySelector('fieldset')
  if (fields.disabled) return
  loginError.textContent = ''
  fields.disabled = true
  loginSubmit.textContent = 'Ingresando…'
  try {
    const response = await fetch(apiBase + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUser.value.trim(), password: loginPassword.value }),
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || typeof data?.token !== 'string') {
      throw new Error(data?.error || 'No se pudo iniciar sesión. Inténtalo otra vez.')
    }
    sessionStorage.setItem(sessionKey, data.token)
    session = data.token
    openInventory()
    document.querySelector('#inventory-title').focus()
  } catch (error) {
    loginError.textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
      ? 'No se pudo conectar con el servicio. Inténtalo otra vez.'
      : error.message
  } finally {
    fields.disabled = false
    loginSubmit.textContent = 'Ingresar al inventario'
  }
})

loginSubmit.disabled = false
if (session) openInventory()
