const equipmentBody = document.querySelector('#equipment')
const message = document.querySelector('#message')
const reload = document.querySelector('#reload')

const typeLabels = { camion: 'Camión', excavadora: 'Excavadora', perforadora: 'Perforadora' }
const hours = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })

function equipmentRow(equipment) {
  const row = document.createElement('tr')
  const values = [equipment.codigo, typeLabels[equipment.tipo], hours.format(equipment.horometro) + ' h']
  for (const value of values) {
    row.insertCell().textContent = value
  }
  return row
}

async function loadEquipment() {
  reload.disabled = true
  reload.textContent = 'Actualizar'
  equipmentBody.replaceChildren()
  message.className = ''
  message.textContent = 'Cargando equipos…'

  try {
    const response = await fetch(import.meta.env.API_BASE_URL + '/api/equipos', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!response.ok) throw new Error('Servicio no disponible')
    const { equipos } = await response.json()
    equipmentBody.replaceChildren(...equipos.map(equipmentRow))
    message.textContent = equipos.length ? '' : 'Aún no hay equipos registrados.'
  } catch {
    message.className = 'error'
    message.textContent = 'No se pudo consultar el inventario. Comprueba la conexión y vuelve a intentarlo.'
    reload.textContent = 'Reintentar'
  } finally {
    reload.disabled = false
  }
}

reload.addEventListener('click', loadEquipment)
loadEquipment()
