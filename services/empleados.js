import { diezDigitos, esClaveInterna, formatoCanonico, variantesTelefono } from './telefono.js';

const fallo = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });

// La columna histórica telefono es la PK de pedidos y permisos. Las nuevas
// altas web usan emp_<número codificado> sin mover ninguna clave existente.
export async function guardarEmpleado(client, entrada) {
  const nombre = String(entrada.nombre ?? '').trim();
  const numero = String(entrada.numero_empleado ?? '').trim();
  const telefono = String(entrada.telefono ?? '').trim();
  if (!nombre || !numero) throw fallo('Completa nombre y número de empleado.');
  if (telefono && !esClaveInterna(telefono) && diezDigitos(telefono).length !== 10) {
    throw fallo('El teléfono es opcional; si lo capturas debe tener 10 dígitos.');
  }
  const { data: existente, error: errorBusca } = await client.from('empleados')
    .select('*').eq('numero_empleado', numero).maybeSingle();
  if (errorBusca) throw errorBusca;

  if (existente && telefono && !variantesTelefono(existente.telefono).includes(telefono)
      && formatoCanonico(existente.telefono) !== formatoCanonico(telefono)) {
    throw fallo('Este empleado ya existe. Usa Editar teléfono en su renglón para agregarlo o corregirlo sin perder el historial.', 409);
  }
  if (!existente && esClaveInterna(telefono)) throw fallo('Deja vacío el teléfono para registrar a una persona sin número.');

  const valores = { nombre, activo: entrada.activo ?? existente?.activo ?? true };
  // Campo omitido conserva la asignación anterior; null permite quitarla
  // explícitamente desde los selectores de la plantilla.
  for (const campo of ['zona_default', 'turno_default']) {
    if (Object.hasOwn(entrada, campo)) valores[campo] = entrada[campo] || null;
  }
  let consulta;
  if (existente) {
    consulta = client.from('empleados').update(valores).eq('telefono', existente.telefono);
  } else {
    if (telefono) {
      const { data: ocupantes, error } = await client.from('empleados')
        .select('numero_empleado').in('telefono', variantesTelefono(telefono));
      if (error) throw error;
      if (ocupantes?.length) throw fallo('Ese teléfono ya pertenece a otro número de empleado.', 409);
    }
    consulta = client.from('empleados').insert({ ...valores, numero_empleado: numero,
      telefono: telefono ? formatoCanonico(telefono) : 'emp_' + Buffer.from(numero, 'utf8').toString('hex') });
  }
  const { data, error } = await consulta.select().single();
  if (error?.code === '23505') throw fallo('El empleado o teléfono ya está registrado. Actualiza la plantilla y vuelve a intentarlo.', 409);
  if (error) throw error;
  return data;
}
