# ⚖️ AVI — Documentos legales (BORRADORES)

> **ESTO NO ES ASESORÍA LEGAL.** Son borradores redactados como punto de partida,
> adaptados a la normativa colombiana de protección de datos. **DEBEN ser revisados
> y aprobados por un abogado colombiano antes de publicarse o recolectar datos de
> personas reales.**

## Qué hay aquí
- `politica-tratamiento-datos.md` — Política de Tratamiento de Datos Personales (el documento central de Habeas Data, exigido por la Ley 1581/2012).
- `terminos-y-condiciones.md` — Términos y Condiciones de uso de la app.
- `autorizacion-consentimiento.md` — Texto de autorización/consentimiento que el usuario acepta al registrarse (el "checkbox") + aviso de privacidad corto.

## ⛔ Antes de publicar — pendientes obligatorios

1. **Llenar los [CORCHETES]** con tus datos reales: nombre/razón social, identificación (cédula o NIT), domicilio, correo y teléfono de contacto, y fecha de entrada en vigencia.

2. **Revisión de abogado** — en especial sobre:
   - **Datos sensibles (salud/fitness):** peso, medidas, lesiones, fotos de progreso son *datos sensibles* (Art. 5, Ley 1581). Exigen **consentimiento explícito** y no se puede negar el servicio por no entregarlos, salvo que sean esenciales. El abogado valida cómo lo pedimos.
   - **Menores de edad:** recolectar datos de menores tiene reglas especiales (Decreto 1377, Art. 12). **Recomendación fuerte: el modo libre público debe ser solo para mayores de 18**, o exigir autorización del representante legal. Decisión con el abogado.
   - **Registro Nacional de Bases de Datos (RNBD) ante la SIC:** puede requerirse según el tipo de responsable. El abogado confirma si aplica para ti.
   - **Transferencia internacional de datos:** los datos se guardan en Supabase (servidores fuera de Colombia). Hay que declararlo y el abogado verifica el cumplimiento.

3. **Implementación técnica que acompaña estos documentos (Fases 1-2 del plan):**
   - Checkbox de aceptación en el registro (no pre-marcado).
   - Botón "Descargar mis datos" y **"Eliminar mi cuenta y mis datos"** (derecho de supresión / Habeas Data).
   - Edad mínima o verificación de mayoría de edad en el registro.

## Estado
🟡 Borradores — pendientes de completar datos + revisión legal. NO publicados.
