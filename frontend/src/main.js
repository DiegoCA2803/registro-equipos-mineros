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

const equipmentUrl = import.meta.env.API_BASE_URL + '/api/equipos'
const typeLabels = new Map(Array.from(type.options, (option) => [option.value, option.textContent]))
const hours = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
let editing = null
let removing = null

async function requestEquipment(path = '', { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(equipmentUrl + path, {
      method,
      headers: { Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new Error('No se pudo confirmar la operación. Actualiza el inventario antes de reintentar.')
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

function equipmentRow(equipment) {
  const row = document.createElement('tr')
  row.setAttribute('role', 'row')
  row.dataset.equipmentId = equipment.id
  const values = [equipment.codigo, typeLabels.get(equipment.tipo) ?? equipment.tipo, hours.format(equipment.horometro) + ' h']
  for (const value of values) {
    const cell = row.insertCell()
    cell.setAttribute('role', 'cell')
    cell.textContent = value
  }
  row.cells[2].className = 'hours'

  const actions = row.insertCell()
  actions.className = 'row-actions'
  actions.setAttribute('role', 'cell')
  for (const [label, open] of [['Editar', openEditor], ['Eliminar', openRemoval]]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'row-button'
    button.textContent = label
    button.setAttribute('aria-label', label + ' ' + equipment.codigo)
    button.addEventListener('click', () => open(equipment))
    actions.append(button)
  }
  return row
}

async function loadEquipment() {
  reload.disabled = true
  addEquipment.disabled = true
  reload.textContent = 'Actualizar'
  equipmentBody.replaceChildren()
  message.className = ''
  message.textContent = 'Cargando equipos…'

  try {
    const { equipos } = await requestEquipment()
    const rows = document.createDocumentFragment()
    for (const equipment of equipos) rows.append(equipmentRow(equipment))
    equipmentBody.replaceChildren(rows)
    message.textContent = equipos.length ? '' : 'Aún no hay equipos registrados.'
  } catch {
    message.className = 'error'
    message.textContent = 'No se pudo consultar el inventario. Comprueba la conexión y vuelve a intentarlo.'
    reload.textContent = 'Reintentar'
  } finally {
    reload.disabled = false
    addEquipment.disabled = false
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

for (const dialog of [editor, removal]) {
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
loadEquipment()
