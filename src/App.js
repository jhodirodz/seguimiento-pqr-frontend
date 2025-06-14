import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, getDocs, deleteDoc, doc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';

// --- SECCIÓN DE CONEXIÓN SEGURA AL SERVIDOR ---

// Dirección URL de tu "motor" (backend) que desplegaste en Google Cloud Run.
const BACKEND_URL = 'https://app-seguimiento-pqr-53181891397.europe-west1.run.app/api/generate';

/**
 * Función centralizada y segura para llamar a nuestro propio backend.
 * Ya no llama a la API de Google directamente desde el navegador.
 * @param {string} prompt - El prompt para la IA.
 * @param {object|null} responseSchema - El schema JSON para la respuesta de la IA.
 * @returns {Promise<any>} La respuesta de la IA.
 */
const callMyBackend = async (prompt, responseSchema = null) => {
    const payload = {
        prompt: prompt,
        responseSchema: responseSchema,
    };

    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Error del servidor: ${response.status}`);
        }

        const result = await response.json();
        // El backend ahora envuelve la respuesta en un campo "text"
        return result.text;
    } catch (error) {
        console.error("Error al llamar al backend:", error);
        throw error; // Propaga el error para que la función que llama lo maneje
    }
};

// --- FIN DE LA SECCIÓN DE CONEXIÓN ---


// --- INICIO DE TODA LA LÓGICA DE TU APLICACIÓN ---

// Global variables now read from Vercel's Environment Variables
const appId = process.env.REACT_APP_APP_ID || 'default-app-id';
const firebaseConfig = process.env.REACT_APP_FIREBASE_CONFIG ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG) : {};
const initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || null;

// Define the specific headers for the main table display
const MAIN_TABLE_HEADERS = [
    'SN',
    'CUN',
    'Fecha Radicado',
    'Dia',
    'Fecha Vencimiento',
    'Nombre_Cliente',
    'Nro_Nuip_Cliente',
    'Categoria del reclamo',
    'Prioridad',
    'Estado_Gestion'
];

// Define the specific headers for the case details modal's main grid
const MODAL_DISPLAY_HEADERS = [
    'SN', 'CUN', 'Fecha Radicado', 'Fecha Cierre', 'fecha_asignacion', 'user',
    'Estado_Gestion', 'Fecha_Inicio_Gestion', 'Tiempo_Resolucion_Minutos',
    'Radicado_SIC', 'Fecha_Vencimiento_Decreto', 'Dia', 'Fecha Vencimiento',
    'Tipo_Contrato', 'Numero_Contrato_Marco', 'Nombre_Cliente', 'Nro_Nuip_Cliente', 'Correo_Electronico_Cliente',
    'Direccion_Cliente', 'Ciudad_Cliente', 'Depto_Cliente', 'Nombre_Reclamante',
    'Nro_Nuip_Reclamante', 'Correo_Electronico_Reclamante', 'Direccion_Reclamante',
    'Ciudad_Reclamante', 'Depto_Reclamante', 'HandleNumber', 'AcceptStaffNo',
    'type_request', 'obs', 'Numero_Reclamo_Relacionado',
    'nombre_oficina', 'Tipopago', 'date_add', 'Tipo_Operacion',
    'Prioridad', 'Analisis de la IA', 'Categoria del reclamo', 'Resumen_Hechos_IA', 'Documento_Adjunto'
];

const TIPOS_OPERACION_ASEGURAMIENTO = ["Aseguramiento FS", "Aseguramiento TELCO", "Aseguramiento SINTEL", "Aseguramiento D@VOX"];
const TIPOS_ASEGURAMIENTO = [
    "Eliminar cobros facturados (paz y salvo)", "Ajustes to invoice de cartera", "Aprobación envío SMS",
    "Aseguramiento clientes reconectados", "Aseguramiento FS - No cobro RX - RXM", "Calidad de impresión",
    "Cambio de localidad FS", "Carga a tablas FS", "NO Cobros gastos de cobranza",
    "Generar reconexión FS", "Solicitud ajustes cartera", "Validacion inconsistencias / Aplicar DTO",
    "Validación cambio de suscriptor", "Ajustar cobros por aceleración Baseport", "Confirmar BAJA del servicio",
    "Recepción factura electronica", "Recepción factura fisica", "No cobros plataforma Streaming"
];
const MESES_ASEGURAMIENTO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ESTADOS_TT = ["Pendiente", "Aplicado"];
const ALL_STATUS_OPTIONS = ['Pendiente', 'Iniciado', 'Lectura', 'Resuelto', 'Finalizado', 'Escalado', 'Decretado', 'Traslado SIC', 'Pendiente Ajustes'];
const ALL_PRIORITY_OPTIONS = ['Alta', 'Media', 'Baja'];


const AREAS_ESCALAMIENTO = [
    "Facturación", "Soporte Técnico", "Redes", "Ventas", "Retención",
    "Legal", "Cartera/Recaudo", "Calidad", "Desarrollo/Plataformas", "Otro"
];

const MOTIVOS_ESCALAMIENTO_POR_AREA = {
    "Facturación": ["Ajuste de cobro", "Error en cargos", "Solicitud detalle factura", "Pago no aplicado", "Otro"],
    "Soporte Técnico": ["Falla masiva", "Problema configuración equipo", "Sin servicio", "Intermitencia", "Otro"],
    "Redes": ["Investigación de cobertura", "Falla en infraestructura", "Optimización de señal", "Otro"],
    "Ventas": ["Incumplimiento oferta", "Error en activación", "Solicitud nuevo servicio", "Otro"],
    "Retención": ["Cancelación de servicio", "Mejora de plan", "Inconformidad con servicio", "Otro"],
    "Legal": ["Requerimiento judicial", "Disputa contractual", "Derecho de petición", "Otro"],
    "Cartera/Recaudo": ["Acuerdo de pago", "Pago no aplicado", "Verificación estado de cuenta", "Cobro prejurídico", "Otro"],
    "Calidad": ["Auditoría de proceso", "Incumplimiento SLA", "Mejora de atención", "Otro"],
    "Desarrollo/Plataformas": ["Error en aplicación", "Falla en portal web", "Incidente de seguridad", "Otro"],
    "Otro": ["Motivo general no especificado", "Escalamiento interno general"]
};

const getColombianDateISO = () => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
};

const getDurationInMinutes = (startDateISO, endDateISO) => {
    if (!startDateISO || !endDateISO) return 'N/A';
    const start = new Date(startDateISO); const end = new Date(endDateISO);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'N/A';
    return Math.round((end.getTime() - start.getTime()) / 60000); 
};

const calculateCaseAge = (caseItem) => {
    if (!caseItem || !caseItem['Fecha Radicado']) return 'N/A';

    if (caseItem.SN_Original) { // It's a decreed case, age from its own radicado date
        const radicadoDate = new Date(caseItem['Fecha Radicado'] + 'T00:00:00'); // Assume the date string is clean
        const today = new Date();
        const startOfDayRadicado = new Date(radicadoDate.getFullYear(), radicadoDate.getMonth(), radicadoDate.getDate());
        const startOfDayToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const diffTime = Math.abs(startOfDayToday.getTime() - startOfDayRadicado.getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }
    return caseItem.Dia; // Return original 'Dia' for non-decreed cases
};

const parseCSV = (text) => {
    const headerLineEnd = text.indexOf('\n');
    if (headerLineEnd === -1) return { headers: [], data: [] }; // Handle empty or single-line files
    const headerLine = text.substring(0, headerLineEnd).trim();
    const delimiter = (headerLine.match(/,/g) || []).length >= (headerLine.match(/;/g) || []).length ? ',' : ';';

    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    // Start parsing after the header line
    for (let i = headerLineEnd + 1; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuotes) {
            if (char === '"' && nextChar !== '"') {
                inQuotes = false;
            } else if (char === '"' && nextChar === '"') {
                currentField += '"';
                i++; // Skip the next quote
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === delimiter) {
                currentRow.push(currentField);
                currentField = '';
            } else if (char === '\n' || char === '\r') {
                // If it's a newline character, end the row
                if (char === '\n') {
                    currentRow.push(currentField);
                    if (currentRow.join('').trim() !== '') {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentField = '';
                }
                // Ignore \r, the \n will handle the row break
            } else {
                currentField += char;
            }
        }
    }

    // Add the last field and row if any
    currentRow.push(currentField);
    if (currentRow.join('').trim() !== '') {
        rows.push(currentRow);
    }

    if (rows.length === 0) {
        return { headers: [], data: [] };
    }

    const headers = headerLine.split(delimiter).map(h => h.trim().replace(/"/g, ''));
    const data = [];

    for (const rowData of rows) {
        const row = {};
        headers.forEach((header, index) => {
            let value = (rowData[index] || '').trim();
            // Clean up surrounding quotes if they exist, but not those inside
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1).replace(/""/g, '"'); // Unescape double quotes
            }

            // Existing logic for specific fields
            if (header === 'Nro_Nuip_Cliente' && (value.startsWith('8') || value.startsWith('9')) && value.length > 9) {
                value = value.substring(0, 9);
            } else if (header === 'Nombre_Cliente') {
                value = value.toUpperCase();
            }
            row[header] = value;
        });
        data.push(row);
    }

    return { headers, data };
};

const getAIAnalysisAndCategory = async (caseData) => {
    const prompt = `Analiza el siguiente caso de reclamo y proporciona:
1. Un "Analisis de la IA" conciso (máximo 200 palabras).
2. Una "Categoria del reclamo" que sea específica y descriptiva (ej. "Solicitud de documentos contrato", "Error en facturación servicio internet", "Falla técnica línea telefónica", "Problema calidad señal TV"). Evita categorías de una sola palabra genérica como "Contrato" o "Facturación" si se puede ser más específico.

    Detalles del Caso:
    SN: ${caseData.SN || 'N/A'}
    Fecha Radicado: ${caseData['Fecha Radicado'] || 'N/A'}
    Nombre Cliente: ${caseData.Nombre_Cliente || 'N/A'}
    Estado: ${caseData.Estado || 'N/A'}
    Nivel 1: ${caseData.Nivel_1 || 'N/A'}
    Nivel 2: ${caseData.Nivel_2 || 'N/A'}
    Nivel 3: ${caseData.Nivel_3 || 'N/A'}
    Nivel 4: ${caseData.Nivel_4 || 'N/A'}
    Nivel 5: ${caseData.Nivel_5 || 'N/A'}
    Observaciones Iniciales (obs): ${caseData.obs || 'N/A'}
    Tipo de Operación: ${caseData.Tipo_Operacion || 'N/A'}`;
    const responseSchema = { type: "OBJECT", properties: { "analisis_ia": { "type": "STRING" }, "categoria_reclamo": { "type": "STRING" } }, "propertyOrdering": ["analisis_ia", "categoria_reclamo"] };
    try {
        const responseText = await callMyBackend(prompt, responseSchema);
        const json = JSON.parse(responseText);
        return { 'Analisis de la IA': json.analisis_ia, 'Categoria del reclamo': json.categoria_reclamo };
    } catch (e) { console.error("Error AI analysis:", e); throw new Error(`Error IA (análisis): ${e.message}`); }
};


const getAIPriority = async (obsText) => {
    const prompt = `Asigna "Prioridad" ("Alta", "Media", "Baja") a obs: ${obsText || 'N/A'}. Default "Media". JSON: {"prioridad": "..."}`;
    const responseSchema = { type: "OBJECT", properties: { "prioridad": { "type": "STRING" } }, "propertyOrdering": ["prioridad"] };
    try {
        const responseText = await callMyBackend(prompt, responseSchema);
        const json = JSON.parse(responseText);
        return json.prioridad || 'Media';
    } catch (e) { console.error("Error AI priority:", e); throw new Error(`Error IA (prioridad): ${e.message}`); }
};

const getAISummary = async (caseData) => {
    const prompt = `Genera resumen (1ra persona, max 200 chars) de hechos y pretensiones.
    Detalles: SN: ${caseData.SN || 'N/A'}, Radicado: ${caseData['Fecha Radicado'] || 'N/A'}, Cliente: ${caseData.Nombre_Cliente || 'N/A'},
    Obs: ${caseData.obs || 'N/A'}, Solicitud: ${caseData.type_request || 'N/A'},
    Niveles: ${[1, 2, 3, 4, 5].map(n => caseData[`Nivel_${n}`] || 'N/A').join(', ')}, Operación: ${caseData.Tipo_Operacion || 'N/A'}
    JSON: {"resumen_cliente": "..."}`;
    const responseSchema = { type: "OBJECT", properties: { "resumen_cliente": { "type": "STRING" } }, "propertyOrdering": ["resumen_cliente"] };
    try {
        const responseText = await callMyBackend(prompt, responseSchema);
        const json = JSON.parse(responseText);
        return json.resumen_cliente || 'No se pudo generar resumen.';
    } catch (e) { console.error("Error AI summary:", e); throw new Error(`Error IA (resumen): ${e.message}`); }
};

const getAIResponseProjection = async (lastObservationText, caseData, contractType) => {
    let contractSpecificInstructions = '';
    if (contractType === 'Contrato Marco') {
        contractSpecificInstructions = `
    **Enfoque Normativo (Contrato Marco):** La respuesta NO DEBE MENCIONAR el Régimen de Protección de Usuarios de Servicios de Comunicaciones (Resolución CRC 5050 de 2016 y sus modificaciones). 
    En su lugar, debe basarse en las disposiciones del Código de Comercio colombiano, los términos y condiciones específicos del contrato marco suscrito entre las partes, y la legislación mercantil aplicable.
    NO incluir la frase: "le recordamos que puede acudir a la Superintendencia de Industria y Comercio (SIC), en ejercicio de las funciones de inspección, vigilancia y control establecidas en la Ley 1480 de 2011 (Estatuto del Consumidor)".`;
    } else { // Default to Condiciones Uniformes
        contractSpecificInstructions = `
    **Enfoque Normativo (Condiciones Uniformes):** La respuesta DEBE basarse principalmente en el Régimen de Protección de los Derechos de los Usuarios de Servicios de Comunicaciones (Establecido por la Comisión de Regulación de Comunicaciones - CRC, por ejemplo, Resolución CRC 5050 de 2016 y sus modificaciones), la Ley 1480 de 2011 (Estatuto del Consumidor) en lo aplicable, y las directrices de la Superintendencia de Industria y Comercio (SIC).
    Puede incluir la frase: "le recordamos que puede acudir a la Superintendencia de Industria y Comercio (SIC), en ejercicio de las funciones de inspección, vigilancia y control establecidas en la Ley 1480 de 2011 (Estatuto del Consumidor)" si es pertinente.`;
    }

    const accumulatedSNInfo = (caseData.SNAcumulados_Historial || [])
        .map((item, index) => `  Reclamo Acumulado ${index + 1}:\n   - SN: ${item.sn}\n   - Observación: ${item.obs}`)
        .join('\n');
    
    const relatedClaimInfo = caseData.Numero_Reclamo_Relacionado && caseData.Numero_Reclamo_Relacionado !== 'N/A' 
        ? `**Reclamo Relacionado (SN: ${caseData.Numero_Reclamo_Relacionado}):**\n   - Observaciones: ${caseData.Observaciones_Reclamo_Relacionado || 'No hay observaciones para el reclamo relacionado.'}\n`
        : 'No hay un reclamo principal relacionado.';


    const prompt = `Eres un asistente legal experto en regulaciones de telecomunicaciones colombianas.
Analiza TODA la información proporcionada: observación principal, observaciones del reclamo relacionado, historial de SN acumulados, y detalles del caso.
Genera una 'Proyección de Respuesta' integral que la empresa (COLOMBIA TELECOMUNICACIONES S.A. E.S.P BIC) podría dar al cliente, abordando TODOS los hechos y pretensiones de fondo.

**Instrucciones CRÍTICAS para la Proyección de Respuesta:**
1.  **Contexto Completo:** La respuesta DEBE considerar y sintetizar la información de TODAS las siguientes fuentes:
    -   Observación principal/última gestión.
    -   Observaciones del "Reclamo Relacionado" si existe.
    -   TODOS los "Reclamos Acumulados" (SN Acumulados) y sus observaciones.
    -   El resumen y análisis de la IA.
    -   Observaciones iniciais del caso (obs).
2.  **Adherencia a los Hechos:** Céntrate ÚNICA Y EXCLUSIVAMENTE en los hechos y pretensiones mencionados en las fuentes. NO introduzcas información o soluciones no mencionadas.
3.  **Dirigida al Cliente:** Respuesta directa al cliente.
4.  **Formato en Párrafos:** Estructura en párrafos claros y coherentes.
5.  **Valores Monetarios:** Si se mencionan cifras, escríbelas en números y luego entre paréntesis en letras (ej: $100.000 (cien mil pesos)).
6.  **Sustento Normativo:** Fundamenta CADA PARTE de la respuesta con normas colombianas VIGENTES (SIC, CRC, leyes).
${contractSpecificInstructions}
7.  **Profesional y Concisa:** Tono profesional, conciso, sin jerga excesiva.

**FUENTES DE INFORMACIÓN A CONSIDERAR:**

**1. Observación Principal / Última Gestión:**
'${lastObservationText || 'No hay observación reciente.'}'

**2. Historial de Observaciones (Contexto General):**
${(caseData.Observaciones_Historial || []).map(obs => `- ${obs.text} (${new Date(obs.timestamp).toLocaleDateString()})`).join('\n') || 'No hay historial de observaciones.'}

**3. Resumen y Análisis de la IA:**
- Resumen Hechos IA: ${caseData.Resumen_Hechos_IA || 'N/A'}
- Análisis IA: ${caseData['Analisis de la IA'] || 'N/A'}

**4. Información del Reclamo Relacionado:**
${relatedClaimInfo}

**5. Información de SN Acumulados Adicionales:**
${accumulatedSNInfo || 'No hay SN acumulados.'}

**6. Detalles del Caso (Contexto General):**
SN Principal: ${caseData.SN || 'N/A'}, Radicado: ${caseData['Fecha Radicado'] || 'N/A'}, Cliente: ${caseData.Nombre_Cliente || 'N/A'}
Obs Iniciales (contexto): ${caseData.obs || 'N/A'}, Tipo Operación: ${caseData.Tipo_Operacion || 'N/A'}
Tipo de Contrato: ${contractType || 'No especificado'}

**Formato de respuesta JSON:** { "proyeccion_respuesta_ia": "..." }`;

    const responseSchema = { type: "OBJECT", properties: { "proyeccion_respuesta_ia": { "type": "STRING" } }, "propertyOrdering": ["proyeccion_respuesta_ia"] };
    try {
        const responseText = await callMyBackend(prompt, responseSchema);
        const json = JSON.parse(responseText);
        return json.proyeccion_respuesta_ia || 'No se pudo generar proyección.';
    } catch (e) { console.error("Error AI projection:", e); throw new Error(`Error IA (proyección): ${e.message}`); }
};

const getAIEscalationSuggestion = async (caseData) => {
    const prompt = `Basado en los detalles de este caso, sugiere un "Área Escalada" y un "Motivo/Acción Escalado".
Áreas Disponibles: ${AREAS_ESCALAMIENTO.join(', ')}.
Razones por Área: ${JSON.stringify(MOTIVOS_ESCALAMIENTO_POR_AREA)}.
Detalles del Caso:
- Observaciones: ${caseData.obs || 'N/A'}
- Categoría Reclamo: ${caseData['Categoria del reclamo'] || 'N/A'}
- Análisis IA: ${caseData['Analisis de la IA'] || 'N/A'}
Responde SOLO con JSON: {"area": "...", "motivo": "..."}`;
    
    const responseSchema = { type: "OBJECT", properties: { "area": { "type": "STRING" }, "motivo": { "type": "STRING" } }, "propertyOrdering": ["area", "motivo"] };
    try {
        const responseText = await callMyBackend(prompt, responseSchema);
        const json = JSON.parse(responseText);
        return json;
    } catch (e) {
        console.error("Error en la sugerencia de escalación por IA:", e);
        throw new Error(`Error IA (sugerencia escalación): ${e.message}`);
    }
};

const extractRelatedComplaintNumber = (obsText) => {
    if (!obsText || typeof obsText !== 'string') return 'N/A';
    const match = obsText.toLowerCase().match(/\b(\d{16}|\d{20})\b/i);
    return match ? (match[1] || 'N/A') : 'N/A';
};

const copyToClipboard = (text, fieldName, showMessageCallback) => {
    if (!text) {
        showMessageCallback(`No hay contenido en "${fieldName}" para copiar.`);
        return;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showMessageCallback(`Contenido de "${fieldName}" copiado al portapapeles.`);
    } catch (err) {
        console.error('Error al copiar al portapapeles:', err);
        showMessageCallback(`Error al copiar "${fieldName}". Intenta manualmente.`);
    }
    document.body.removeChild(textArea);
};

const PaginatedTable = ({ cases, title, mainTableHeaders, statusColors, priorityColors, selectedCaseIds, handleSelectCase, handleOpenCaseDetails, onScanClick }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const casesPerPage = 10;

    const indexOfLastCase = currentPage * casesPerPage;
    const indexOfFirstCase = indexOfLastCase - casesPerPage;
    const currentCases = cases.slice(indexOfFirstCase, indexOfLastCase);
    const totalPages = Math.ceil(cases.length / casesPerPage);

    const paginate = (pageNumber) => {
        if (pageNumber < 1 || pageNumber > totalPages) return;
        setCurrentPage(pageNumber);
    };
    
    useEffect(() => {
        setCurrentPage(1);
    }, [cases]);


    return (
        <div className="mb-8">
            <h3 className="text-xl font-bold text-gray-800 mb-4 px-2 py-1 bg-gray-200 rounded-md">{title} ({cases.length})</h3>
            <div className="overflow-x-auto rounded-lg shadow-md border">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-teal-500">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                                <input 
                                    type="checkbox"
                                    className="form-checkbox h-4 w-4 text-blue-600"
                                    onChange={(e) => {
                                        const newSelectedIds = new Set(selectedCaseIds);
                                        if (e.target.checked) {
                                            cases.forEach(c => newSelectedIds.add(c.id));
                                        } else {
                                            cases.forEach(c => newSelectedIds.delete(c.id));
                                        }
                                        handleSelectCase(newSelectedIds, true); // Use a flag to indicate mass update
                                    }}
                                    checked={cases.length > 0 && cases.every(c => selectedCaseIds.has(c.id))}
                                    disabled={cases.length === 0}
                                />
                            </th>
                            {mainTableHeaders.map(h => <th key={h} className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">{h}</th>)}
                            <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {currentCases.length > 0 ? currentCases.map(c => (
                            <tr key={c.id} className={`hover:bg-gray-50 ${selectedCaseIds.has(c.id) ? 'bg-blue-50' : (c.Prioridad === 'Alta' ? 'bg-red-100' : '')}`}>
                                <td className="px-4 py-4 whitespace-nowrap">
                                    <input 
                                        type="checkbox"
                                        className="form-checkbox h-4 w-4 text-blue-600"
                                        checked={selectedCaseIds.has(c.id)}
                                        onChange={() => handleSelectCase(c.id)}
                                    />
                                </td>
                                {mainTableHeaders.map(h => {
                                    let v = c[h] || 'N/A';
                                    if (h === 'Nro_Nuip_Cliente' && (!v || v === '0')) v = c.Nro_Nuip_Reclamante || 'N/A';
                                    if (h === 'Dia') v = calculateCaseAge(c);
                                    if (h === 'Estado_Gestion') return <td key={h} className="px-6 py-4"><span className={`px-2 inline-flex text-xs font-semibold rounded-full ${statusColors[v] || statusColors['N/A']}`}>{v}</span></td>;
                                    if (h === 'Prioridad') return <td key={h} className="px-6 py-4"><span className={`px-2 inline-flex text-xs font-semibold rounded-full ${priorityColors[v] || priorityColors['N/A']}`}>{v}</span></td>;
                                    return <td key={h} className="px-6 py-4 whitespace-nowrap text-sm">{v}</td>
                                })}
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                    <button onClick={e => { e.stopPropagation(); handleOpenCaseDetails(c); }} className="text-blue-600 hover:text-blue-900">Ver Detalles</button>
                                    {c.Documento_Adjunto && String(c.Documento_Adjunto).startsWith('http') && (
                                        <a href={c.Documento_Adjunto} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-4 text-green-600 hover:text-green-900 font-semibold">
                                            Ver Adjunto
                                        </a>
                                    )}
                                    {c.Documento_Adjunto === "Si_Adjunto" && (
                                        <button onClick={(e) => { e.stopPropagation(); onScanClick(c); }} className="ml-4 text-green-600 hover:text-green-900 font-semibold">
                                            ✨ Escanear Adjunto
                                        </button>
                                    )}
                                </td>
                            </tr>
                        )) : <tr><td colSpan={mainTableHeaders.length + 2} className="p-6 text-center">No hay casos.</td></tr>}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <nav className="mt-4" aria-label="Pagination">
                    <ul className="flex justify-center items-center -space-x-px">
                        <li>
                            <button onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-2 ml-0 leading-tight text-gray-500 bg-white border border-gray-300 rounded-l-lg hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
                                Anterior
                            </button>
                        </li>
                        {[...Array(totalPages).keys()].map(number => (
                            <li key={number + 1}>
                                <button onClick={() => paginate(number + 1)} className={`px-3 py-2 leading-tight border border-gray-300 ${currentPage === number + 1 ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 hover:text-blue-700' : 'text-gray-500 bg-white hover:bg-gray-100 hover:text-gray-700'}`}>
                                    {number + 1}
                                </button>
                            </li>
                        ))}
                        <li>
                            <button onClick={() => paginate(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-2 leading-tight text-gray-500 bg-white border border-gray-300 rounded-r-lg hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
                                Siguiente
                            </button>
                        </li>
                    </ul>
                </nav>
            )}
        </div>
    );
};


function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [cases, setCases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [modalContent, setModalContent] = useState({ message: '', isConfirm: false, onConfirm: () => {}, confirmText: 'Confirmar', cancelText: 'Cancelar' });
    const [selectedCase, setSelectedCase] = useState(null);
    const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [isGeneratingResponseProjection, setIsGeneratingResponseProjection] = useState(false);
    const [isSuggestingEscalation, setIsSuggestingEscalation] = useState(false);
    const [duplicateCasesDetails, setDuplicateCasesDetails] = useState([]);
    const [showManualEntryModal, setShowManualEntryModal] = useState(false);
    const initialManualFormData = {
        SN: '', CUN: '', FechaRadicado: '', FechaVencimiento: '', Nro_Nuip_Cliente: '', Nombre_Cliente: '',
        OBS: '', Dia: '', Tipo_Contrato: 'Condiciones Uniformes', Numero_Contrato_Marco: '',
        Requiere_Aseguramiento_Facturas: false, ID_Aseguramiento: '', Corte_Facturacion: '',
        Operacion_Aseguramiento: '', Tipo_Aseguramiento: '', Mes_Aseguramiento: '', Cuenta: '',
        requiereBaja: false, numeroOrdenBaja: '',
        requiereAjuste: false, numeroTT: '', estadoTT: '', requiereDevolucionDinero: false,
        cantidadDevolver: '', idEnvioDevoluciones: '', fechaEfectivaDevolucion: '',
        areaEscalada: '', motivoEscalado: '', idEscalado: '', reqGenerado: '', Estado_Gestion: 'Pendiente'
    };
    const [manualFormData, setManualFormData] = useState(initialManualFormData);
    const fileInputRef = useRef(null);
    const [activeFilter, setActiveFilter] = useState('all');
    const [priorityFilter, setPriorityFilter] = useState('all');
    const [currentDateTime, setCurrentDateTime] = useState(new Date());
    const [selectedCaseIds, setSelectedCaseIds] = useState(new Set());
    const [massUpdateTargetStatus, setMassUpdateTargetStatus] = useState('');
    const [isMassUpdating, setIsMassUpdating] = useState(false);
    const [activeModule, setActiveModule] = useState('casos');
    const [caseToScan, setCaseToScan] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const scanFileInputRef = useRef(null);

    // State for SN Acumulados
    const [tieneSNAcumulados, setTieneSNAcumulados] = useState(false);
    const [cantidadSNAcumulados, setCantidadSNAcumulados] = useState(0);
    const [snAcumuladosData, setSnAcumuladosData] = useState([]);
    const [showGestionesAdicionales, setShowGestionesAdicionales] = useState(true);
    const [aseguramientoObs, setAseguramientoObs] = useState('');
    const cancelUpload = useRef(false);


    const statusColors = {
        'Pendiente':'bg-yellow-200 text-yellow-800',
        'Resuelto':'bg-green-200 text-green-800',
        'Finalizado': 'bg-gray-500 text-white',
        'Escalado':'bg-red-200 text-red-800',
        'Iniciado':'bg-indigo-200 text-indigo-800',
        'Lectura':'bg-blue-200 text-blue-800',
        'Decretado':'bg-purple-200 text-purple-800',
        'Traslado SIC':'bg-orange-600 text-white',
        'Pendiente Ajustes': 'bg-pink-200 text-pink-800',
        'N/A':'bg-gray-200 text-gray-800'
    };
    const priorityColors = {'Alta':'bg-red-500 text-white','Media':'bg-orange-400 text-white','Baja':'bg-blue-400 text-white','N/A':'bg-gray-400 text-white'};

    const displayModalMessage = useCallback((message) => {
        setModalContent({ message, isConfirm: false, onConfirm: () => {} });
        setShowModal(true);
    }, []);

    const displayConfirmModal = useCallback((message, { onConfirm, onCancel, confirmText = 'Confirmar', cancelText = 'Cancelar' } = {}) => {
        setModalContent({
            message,
            isConfirm: true,
            onConfirm: onConfirm || (() => {}),
            onCancel: onCancel || (() => setShowModal(false)),
            confirmText,
            cancelText
        });
        setShowModal(true);
    }, []);

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            setDb(getFirestore(app)); setAuth(getAuth(app));
            const unsub = onAuthStateChanged(getAuth(app), async user => {
                if (user) setUserId(user.uid);
                else try { if (initialAuthToken) await signInWithCustomToken(getAuth(app), initialAuthToken); else await signInAnonymously(getAuth(app)); } catch (e) { console.error("Sign-in error:", e); displayModalMessage(`Auth Error: ${e.message}`); }
                setLoading(false);
            }); return () => unsub();
        } catch (e) { console.error("Firebase init error:", e); displayModalMessage(`Firebase Init Error: ${e.message}`); setLoading(false); }
    }, [displayModalMessage]);

    useEffect(() => {
        if (!db || !userId) return;
        const q = query(collection(db, `artifacts/${appId}/users/${userId}/cases`));
        const unsub = onSnapshot(q, async snapshot => {
            const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            const updates = fetched.filter(c => c.user === 'jediazro' && c.user !== userId).map(c => updateDoc(doc(db, `artifacts/${appId}/users/${userId}/cases`, c.id), { user: userId }));
            if (updates.length > 0) await Promise.all(updates).catch(e => console.error("Auto-assign error:", e));
            fetched.sort((a,b) => (new Date(b['Fecha Radicado'] || 0)) - (new Date(a['Fecha Radicado'] || 0) || a.id.localeCompare(b.id)));
            setCases(fetched);
            setRefreshing(false);
        }, e => {
            console.error("Fetch cases error (onSnapshot):", e);
            displayModalMessage(`Error loading cases: ${e.message}`);
            setRefreshing(false);
        });
        return () => unsub();
    }, [db, userId, displayModalMessage]);

    useEffect(() => {
        if (!db || !userId || cases.length === 0) return;
    
        const casesToFinalize = cases.filter(c =>
            c.Estado_Gestion === 'Resuelto' &&
            !c.Requiere_Aseguramiento_Facturas &&
            !c.requiereBaja &&
            !c.requiereAjuste
        );
    
        if (casesToFinalize.length > 0) {
            const batch = writeBatch(db);
            casesToFinalize.forEach(caseItem => {
                const caseRef = doc(db, `artifacts/${appId}/users/${userId}/cases`, caseItem.id);
                batch.update(caseRef, { Estado_Gestion: 'Finalizado' });
            });
            
            batch.commit().catch(error => {
                console.error("Error finalizing cases automatically:", error);
                displayModalMessage(`Error al finalizar casos automáticamente: ${error.message}`);
            });
        }
    }, [cases, db, userId, displayModalMessage]);

    const forceRefreshCases = async () => {
        if (!db || !userId) {
            displayModalMessage("Base de datos no disponible o usuario no autenticado.");
            return;
        }
        setRefreshing(true);
        displayModalMessage("Actualizando lista de casos...");
        try {
            const collRef = collection(db, `artifacts/${appId}/users/${userId}/cases`);
            const snapshot = await getDocs(collRef);
            const fetchedCases = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            fetchedCases.sort((a,b) => (new Date(b['Fecha Radicado'] || 0)) - (new Date(a['Fecha Radicado'] || 0) || a.id.localeCompare(b.id)));
            setCases(fetchedCases);
            displayModalMessage("Lista de casos actualizada.");
        } catch (error) {
            console.error("Error during manual refresh:", error);
            displayModalMessage(`Error al actualizar casos: ${error.message}`);
        } finally {
            setRefreshing(false);
        }
    };


    useEffect(() => {
        if (cases.length > 0 && !sessionStorage.getItem('decretadoAlarmShown')) {
            const today = new Date(); today.setHours(0,0,0,0);
            const twoDaysHence = new Date(today); twoDaysHence.setDate(today.getDate()+2); twoDaysHence.setHours(23,59,59,999);
            const expiring = cases.filter(c => c.Estado_Gestion === 'Decretado' && c.Fecha_Vencimiento_Decreto && new Date(c.Fecha_Vencimiento_Decreto) >= today && new Date(c.Fecha_Vencimiento_Decreto) <= twoDaysHence);
            if (expiring.length > 0) {
                displayModalMessage(`ALERTA! Casos "Decretados" próximos a vencer:\n${expiring.map(c=>`SN: ${c.SN}, Vence: ${c.Fecha_Vencimiento_Decreto}`).join('\n')}`);
                sessionStorage.setItem('decretadoAlarmShown', 'true');
            }
        }
    }, [cases, displayModalMessage]);

    useEffect(() => {
        const checkIniciadoCases = () => {
            const now = new Date().toISOString();
            cases.forEach(caseItem => {
                if (caseItem.Estado_Gestion === 'Iniciado' && caseItem.Fecha_Inicio_Gestion) {
                    const duration = getDurationInMinutes(caseItem.Fecha_Inicio_Gestion, now);
                    if (duration !== 'N/A' && duration > 45) {
                        const alertShownKey = `iniciadoAlertShown_${caseItem.id}`;
                        if (!sessionStorage.getItem(alertShownKey)) {
                            displayModalMessage(`¡ALERTA! El caso SN: ${caseItem.SN} (CUN: ${caseItem.CUN || 'N/A'}) ha estado en estado "Iniciado" por más de 45 minutos.`);
                            sessionStorage.setItem(alertShownKey, 'true');
                        }
                    }
                }
            });
        };
        const intervalId = setInterval(checkIniciadoCases, 30000);
        return () => clearInterval(intervalId);
    }, [cases, displayModalMessage]);


    useEffect(() => { const timer = setInterval(() => setCurrentDateTime(new Date()), 1000); return () => clearInterval(timer); }, []);

    const handleFileUpload = async (event) => {
        const file = event.target.files[0]; if (!file) return;
        setUploading(true);
        cancelUpload.current = false;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const { data: csvDataRows } = parseCSV(e.target.result);
                if (csvDataRows.length === 0) { displayModalMessage('CSV vacío o inválido.'); setUploading(false); return; }
                if (!db || !userId) { displayModalMessage('DB no lista o usuario no auth.'); setUploading(false); return; }
                
                const collRef = collection(db, `artifacts/${appId}/users/${userId}/cases`);
                const today = getColombianDateISO();
                
                const existingDocsSnapshot = await getDocs(collRef);
                const existingCasesMap = new Map(existingDocsSnapshot.docs.map(d => [String(d.data().SN || '').trim(), { id: d.id, ...d.data() }]));
                
                let addedCount = 0;
                let updatedCount = 0;
                let skippedCount = 0;

                for (let i = 0; i < csvDataRows.length; i++) {
                    if (cancelUpload.current) {
                        console.log("Carga cancelada por el usuario.");
                        break;
                    }
                    const row = csvDataRows[i];
                    const currentSN = String(row.SN || '').trim();

                    if (!currentSN) {
                        skippedCount++;
                        continue;
                    }
                    
                    displayModalMessage(`Procesando ${i + 1}/${csvDataRows.length}...`);

                    if (existingCasesMap.has(currentSN)) {
                        const existingCaseData = existingCasesMap.get(currentSN);
                        
                        try {
                            await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/cases`, existingCaseData.id), row);
                            updatedCount++;
                            existingCasesMap.set(currentSN, { ...existingCaseData, ...row });
                        } catch (updateError) {
                            console.error(`Error updating full case data for SN ${currentSN}:`, updateError);
                            skippedCount++;
                        }
                    } else {
                        let aiAnalysisCat = { 'Analisis de la IA': 'N/A', 'Categoria del reclamo': 'N/A' };
                        let aiPrio = 'Media';
                        let relNum = 'N/A';

                        try {
                            aiAnalysisCat = await getAIAnalysisAndCategory(row);
                            aiPrio = await getAIPriority(row['obs']);
                            relNum = extractRelatedComplaintNumber(row['obs']);
                        } catch (aiErr) {
                            console.error(`AI Error for new SN ${currentSN}:`, aiErr);
                        }

                        await addDoc(collRef, {
                            ...row,
                            user: userId,
                            Estado_Gestion: row.Estado_Gestion || 'Pendiente',
                            ...aiAnalysisCat,
                            Prioridad: aiPrio,
                            Numero_Reclamo_Relacionado: relNum,
                            Observaciones_Reclamo_Relacionado: '',
                            Aseguramiento_Historial: [],
                            Escalamiento_Historial: [],
                            Resumen_Hechos_IA: 'No generado',
                            Proyeccion_Respuesta_IA: 'No generada',
                            Tipo_Contrato: 'Condiciones Uniformes',
                            Numero_Contrato_Marco: '',
                            fecha_asignacion: today,
                            Observaciones_Historial: [],
                            SNAcumulados_Historial: [],
                            Dia: row['Dia'] ?? 'N/A',
                            Dia_Original_CSV: row['Dia'] ?? 'N/A',
                            Despacho_Respuesta_Checked: false,
                            Fecha_Inicio_Gestion: '',
                            Tiempo_Resolucion_Minutos: 'N/A',
                            Radicado_SIC: '',
                            Fecha_Vencimiento_Decreto: '',
                            Requiere_Aseguramiento_Facturas: false, ID_Aseguramiento: '',
                            Corte_Facturacion: row['Corte_Facturacion'] || '',
                            Operacion_Aseguramiento: '', Tipo_Aseguramiento: '', Mes_Aseguramiento: '',
                            Cuenta: row['Cuenta'] || '',
                            requiereBaja: false, numeroOrdenBaja: '',
                            requiereAjuste: false, numeroTT: '', estadoTT: '', requiereDevolucionDinero: false,
                            cantidadDevolver: '', idEnvioDevoluciones: '', fechaEfectivaDevolucion: '',
                            areaEscalada: '', motivoEscalado: '', idEscalado: '', reqGenerado: '', descripcionEscalamiento: ''
                        });
                        addedCount++;
                        existingCasesMap.set(currentSN, { id: 'temp_new_id', SN: currentSN, ...row });
                    }
                }
                if (cancelUpload.current) {
                     displayModalMessage(`Carga cancelada. ${addedCount} casos nuevos agregados, ${updatedCount} actualizados.`);
                } else {
                     displayModalMessage(`Carga Completa: ${addedCount} casos nuevos agregados. ${updatedCount} casos existentes actualizados. ${skippedCount} casos omitidos.`);
                }
            } catch (err) {
                displayModalMessage(`Error durante la carga del CSV: ${err.message}`);
            }
            finally {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.onerror = (err) => {
            displayModalMessage(`Error leyendo el archivo: ${err.message}`);
            setUploading(false);
        };
        reader.readAsText(file);
    };
    
    const handleOpenCaseDetails = async (caseItem) => {
        setSelectedCase(caseItem);
        setTieneSNAcumulados(false);
        setCantidadSNAcumulados(0);
        setSnAcumuladosData([]);
        setAseguramientoObs('');

        setDuplicateCasesDetails([]);
        if (db && userId) {
            const { Nro_Nuip_Cliente: nuip, CUN: cun, id: currentId } = caseItem;
            let dups = [];
            if (nuip && nuip !== '0' && nuip !== 'N/A') (await getDocs(query(collection(db, `artifacts/${appId}/users/${userId}/cases`), where('Nro_Nuip_Cliente', '==', nuip)))).forEach(d => { if (d.id !== currentId) dups.push({ ...d.data(), id: d.id, type: 'Nro_Nuip_Cliente' }); });
            if (cun && cun !== 'N/A') (await getDocs(query(collection(db, `artifacts/${appId}/users/${userId}/cases`), where('CUN', '==', cun)))).forEach(d => { if (d.id !== currentId && !dups.some(x => x.id === d.id)) dups.push({ ...d.data(), id: d.id, type: 'CUN' }); });
            setDuplicateCasesDetails(dups);
        }
    };
    const handleCloseCaseDetails = () => {
        setSelectedCase(null);
        setDuplicateCasesDetails([]);
        setTieneSNAcumulados(false);
        setCantidadSNAcumulados(0);
        setSnAcumuladosData([]);
        setAseguramientoObs('');
    };
    const updateCaseInFirestore = async (caseId, newData) => { if (!db || !userId) return; try { await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/cases`, caseId), newData); } catch (e) { console.error("Update error:", e); displayModalMessage(`Error update: ${e.message}`); }};
    
    const handleModalFieldChange = (fieldName, value) => {
        if (!selectedCase) return;
        const isChecked = typeof value === 'boolean' ? value : (value === 'true');
        let updatedCaseData = { ...selectedCase };
        const firestoreUpdateData = {};
    
        // Generic value normalization
        if (fieldName === 'Nombre_Cliente') value = value.toUpperCase();
        else if (fieldName === 'Nro_Nuip_Cliente' && (String(value).startsWith('8') || String(value).startsWith('9')) && String(value).length > 9) value = String(value).substring(0, 9);
    
        updatedCaseData[fieldName] = value;
        firestoreUpdateData[fieldName] = value;
    
        // Specific logic for checkbox interactions
        if (['Requiere_Aseguramiento_Facturas', 'requiereBaja', 'requiereAjuste'].includes(fieldName)) {
            if (isChecked) {
                // Uncheck "Despacho Respuesta" if any of these are checked
                updatedCaseData.Despacho_Respuesta_Checked = false;
                firestoreUpdateData.Despacho_Respuesta_Checked = false;
            }
    
            if (!isChecked) {
                // Clear dependent fields if unchecked
                if (fieldName === 'Requiere_Aseguramiento_Facturas') {
                    Object.assign(firestoreUpdateData, { ID_Aseguramiento: '', Corte_Facturacion: '', Cuenta: '', Operacion_Aseguramiento: '', Tipo_Aseguramiento: '', Mes_Aseguramiento: '' });
                } else if (fieldName === 'requiereBaja') {
                    firestoreUpdateData.numeroOrdenBaja = '';
                } else if (fieldName === 'requiereAjuste') {
                    Object.assign(firestoreUpdateData, { numeroTT: '', estadoTT: '', requiereDevolucionDinero: false, cantidadDevolver: '', idEnvioDevoluciones: '', fechaEfectivaDevolucion: '' });
                    if (updatedCaseData.Estado_Gestion === 'Pendiente Ajustes') {
                        firestoreUpdateData.Estado_Gestion = 'Pendiente';
                    }
                }
            }
        } else if (fieldName === 'requiereDevolucionDinero' && !isChecked) {
            Object.assign(firestoreUpdateData, { cantidadDevolver: '', idEnvioDevoluciones: '', fechaEfectivaDevolucion: '' });
        }
    
        // Other specific logic
        if (fieldName === 'estadoTT' && updatedCaseData.requiereAjuste) {
            if (value === 'Pendiente' && updatedCaseData.Estado_Gestion !== 'Pendiente Ajustes') {
                firestoreUpdateData.Estado_Gestion = 'Pendiente Ajustes';
                displayModalMessage('El estado del caso ha cambiado a "Pendiente Ajustes".');
            }
        } else if (fieldName === 'areaEscalada') {
            firestoreUpdateData.motivoEscalado = '';
        }
    
        setSelectedCase(prev => ({ ...prev, ...firestoreUpdateData, [fieldName]: value }));
        updateCaseInFirestore(selectedCase.id, firestoreUpdateData);
    };

    const handleContractTypeChange = (newContractType) => {
        if (!selectedCase) return;
        const updateData = { Tipo_Contrato: newContractType };
        if (newContractType !== 'Contrato Marco') {
            updateData.Numero_Contrato_Marco = '';
        }
        setSelectedCase(prev => ({ ...prev, ...updateData }));
        updateCaseInFirestore(selectedCase.id, updateData);
    };

    const proceedWithResolve = async () => {
        if (!selectedCase) return;
        const batch = writeBatch(db);
        let local = { ...selectedCase, Estado_Gestion: 'Resuelto' };
        
        // Validation checks before resolving
        if (!selectedCase.Despacho_Respuesta_Checked && !selectedCase.Requiere_Aseguramiento_Facturas && !selectedCase.requiereBaja && !selectedCase.requiereAjuste) {
             displayModalMessage('Debe seleccionar "Despacho Respuesta" o una opción de "Gestiones Adicionales" para resolver.'); return;
        }
        if (selectedCase.Requiere_Aseguramiento_Facturas && !selectedCase.ID_Aseguramiento && (!selectedCase.Corte_Facturacion || isNaN(parseFloat(selectedCase.Corte_Facturacion)) || !selectedCase.Cuenta || !selectedCase.Operacion_Aseguramiento || !selectedCase.Tipo_Aseguramiento || !selectedCase.Mes_Aseguramiento)) { displayModalMessage('Para resolver con Aseguramiento, complete todos los campos requeridos.'); return; }
        if (selectedCase.requiereBaja && !selectedCase.numeroOrdenBaja) { displayModalMessage('Si requiere baja, debe ingresar el Número de Orden de Baja.'); return; }
        if (selectedCase.requiereAjuste) {
            if (!selectedCase.numeroTT) { displayModalMessage('Si requiere ajuste, debe ingresar el Número de TT.'); return; }
            if (selectedCase.estadoTT !== 'Aplicado') { displayModalMessage('Si requiere ajuste, el Estado TT debe ser "Aplicado".'); return; }
            if (selectedCase.requiereDevolucionDinero && (!selectedCase.cantidadDevolver || isNaN(parseFloat(selectedCase.cantidadDevolver)) || parseFloat(selectedCase.cantidadDevolver) <= 0 || !selectedCase.idEnvioDevoluciones || !selectedCase.fechaEfectivaDevolucion)) { displayModalMessage('Si requiere devolución, complete todos los campos de devolución.'); return; }
        }

        // Logic for closing accumulated SNs
        if (selectedCase.SNAcumulados_Historial && selectedCase.SNAcumulados_Historial.length > 0) {
            const accumulatedSNs = selectedCase.SNAcumulados_Historial.map(item => item.sn.trim()).filter(Boolean);
            if (accumulatedSNs.length > 0) {
                const q = query(collection(db, `artifacts/${appId}/users/${userId}/cases`), where('SN', 'in', accumulatedSNs));
                const querySnapshot = await getDocs(q);
                querySnapshot.forEach(doc => {
                    batch.update(doc.ref, { Estado_Gestion: 'Resuelto', 'Fecha Cierre': getColombianDateISO() });
                });
            }
        }

        const mainCaseRef = doc(db, `artifacts/${appId}/users/${userId}/cases`, selectedCase.id);
        const today = getColombianDateISO();
        const data = { 
            Estado_Gestion: 'Resuelto',
            'Fecha Cierre': today,
            Tiempo_Resolucion_Minutos: selectedCase.Fecha_Inicio_Gestion ? getDurationInMinutes(selectedCase.Fecha_Inicio_Gestion, new Date().toISOString()) : 'N/A'
        };
        local['Fecha Cierre'] = today;
        local.Tiempo_Resolucion_Minutos = data.Tiempo_Resolucion_Minutos;

        batch.update(mainCaseRef, data);
        setSelectedCase(local);
        await batch.commit();
    };


    const handleDecretarCaso = async () => {
        if (!selectedCase) return;
    
        if (!selectedCase.Despacho_Respuesta_Checked) {
            displayModalMessage("Error: Para decretar el caso, primero debe marcar la casilla 'Despacho Respuesta'.");
            return;
        }

        if (!Array.isArray(selectedCase.Escalamiento_Historial) || selectedCase.Escalamiento_Historial.length === 0) {
            displayModalMessage("Error: Debe guardar un registro de escalación antes de decretar el caso.");
            return;
        }
        if (!selectedCase.Radicado_SIC || !selectedCase.Fecha_Vencimiento_Decreto) {
            displayModalMessage("Error: Debe completar los campos 'Radicado SIC' y 'Fecha Vencimiento Decreto' para poder decretar.");
            return;
        }
    
        displayConfirmModal(
            '¿Está seguro de que desea decretar este caso? Esta acción resolverá el caso actual y creará uno nuevo en estado "Decretado".',
            {
                onConfirm: async () => {
                    try {
                        const batch = writeBatch(db);
                        const today = getColombianDateISO();
                        const timestamp = new Date().toISOString();
                        
                        const provisionalSN = `DECRETO-${Date.now()}`;

                        const newCaseData = { ...selectedCase };
                        delete newCaseData.id; 
                        delete newCaseData.SN_Original;
    
                        Object.assign(newCaseData, {
                            SN: provisionalSN,
                            SN_Original: selectedCase.SN,
                            Estado_Gestion: 'Decretado',
                            'Fecha Radicado': today,
                            'Dia': 0, // Reset day counter for the new case
                            'Fecha Cierre': '',
                            Observaciones_Historial: [
                                ...(selectedCase.Observaciones_Historial || []),
                                { text: `Caso creado por decreto del SN original: ${selectedCase.SN}. Radicado SIC: ${selectedCase.Radicado_SIC}`, timestamp }
                            ],
                            Aseguramiento_Historial: [], 
                            SNAcumulados_Historial: [],
                            Escalamiento_Historial: [],
                            areaEscalada: '', 
                            motivoEscalado: '',
                            idEscalado: '',
                            reqGenerado: '',
                            descripcionEscalamiento: ''
                        });
    
                        const newCaseRef = doc(collection(db, `artifacts/${appId}/users/${userId}/cases`));
                        batch.set(newCaseRef, newCaseData);
    
                        const originalCaseRef = doc(db, `artifacts/${appId}/users/${userId}/cases`, selectedCase.id);
                        const originalCaseUpdate = {
                            Estado_Gestion: 'Resuelto',
                            'Fecha Cierre': today,
                            Observaciones_Historial: [
                                ...(selectedCase.Observaciones_Historial || []),
                                { text: `Caso resuelto por decreto. Se creó un nuevo caso con SN provisional: ${provisionalSN}`, timestamp }
                            ]
                        };
                        batch.update(originalCaseRef, originalCaseUpdate);
    
                        await batch.commit();
                        displayModalMessage('Caso decretado exitosamente. Se ha resuelto el caso actual y se ha creado uno nuevo.');
                        handleCloseCaseDetails();
    
                    } catch (error) {
                        console.error("Error al decretar el caso:", error);
                        displayModalMessage(`Error al decretar el caso: ${error.message}`);
                    }
                },
                confirmText: 'Sí, decretar',
                cancelText: 'No, cancelar'
            }
        );
    };
    
    const handleSaveEscalamientoHistory = async () => {
        if (!selectedCase) return;
        if (!selectedCase.areaEscalada || !selectedCase.motivoEscalado) {
            displayModalMessage('Debe seleccionar el área y el motivo de la escalación para guardar.');
            return;
        }

        const escalamientoData = {
            timestamp: new Date().toISOString(),
            areaEscalada: selectedCase.areaEscalada,
            motivoEscalado: selectedCase.motivoEscalado,
            idEscalado: selectedCase.idEscalado || '',
            reqGenerado: selectedCase.reqGenerado || '',
            descripcionEscalamiento: selectedCase.descripcionEscalamiento || ''
        };

        const newHistory = [...(selectedCase.Escalamiento_Historial || []), escalamientoData];
        try {
            await updateCaseInFirestore(selectedCase.id, { Escalamiento_Historial: newHistory });
            setSelectedCase(prev => ({ ...prev, Escalamiento_Historial: newHistory }));
            displayModalMessage('Historial de escalación guardado.');
        } catch(e) {
            displayModalMessage(`Error guardando historial de escalación: ${e.message}`);
        }
    }


    const handleChangeCaseStatus = async (newStatus) => {
        if (!selectedCase) return;

        if (newStatus === 'Decretado') {
            handleDecretarCaso();
            return;
        }
        
        if (newStatus === 'Resuelto') {
            const needsAssuranceCheck = !selectedCase.Requiere_Aseguramiento_Facturas && !selectedCase.requiereBaja && !selectedCase.requiereAjuste;
            
            if (needsAssuranceCheck) {
                displayConfirmModal(
                    '¿Confirma que el caso NO requiere "Aseguramiento y Gestiones Adicionales"?',
                    {
                        onConfirm: () => proceedWithResolve(),
                        onCancel: () => {
                            setShowModal(false);
                            setShowGestionesAdicionales(true);
                        },
                        confirmText: 'No, no requiere',
                        cancelText: 'Sí, requiere gestión'
                    }
                );
            } else {
                await proceedWithResolve();
            }
        } else {
             const oldStatus = selectedCase.Estado_Gestion;
             const data = { Estado_Gestion: newStatus };
             if (oldStatus === 'Escalado' && newStatus !== 'Escalado') Object.assign(data, { areaEscalada: '', motivoEscalado: '', idEscalado: '', reqGenerado: '', descripcionEscalamiento: '' });
             if (newStatus === 'Iniciado') Object.assign(data, { Fecha_Inicio_Gestion: new Date().toISOString(), Tiempo_Resolucion_Minutos: 'N/A' });
             setSelectedCase(prev => ({ ...prev, ...data }));
             await updateCaseInFirestore(selectedCase.id, data);
        }
    };


    const handleDespachoRespuestaChange = async (e) => {
        if (!selectedCase) return;
        const isChecked = e.target.checked;
        let updateData = { Despacho_Respuesta_Checked: isChecked };
    
        if (isChecked) {
            updateData = {
                ...updateData,
                Requiere_Aseguramiento_Facturas: false,
                requiereBaja: false,
                requiereAjuste: false,
                requiereDevolucionDinero: false,
                ID_Aseguramiento: '',
                Corte_Facturacion: '',
                Cuenta: '',
                Operacion_Aseguramiento: '',
                Tipo_Aseguramiento: '',
                Mes_Aseguramiento: '',
                numeroOrdenBaja: '',
                numeroTT: '',
                estadoTT: '',
                cantidadDevolver: '',
                idEnvioDevoluciones: '',
                fechaEfectivaDevolucion: '',
            };
            if (selectedCase.Estado_Gestion === 'Pendiente Ajustes') {
                 updateData.Estado_Gestion = 'Pendiente';
            }
        }
    
        setSelectedCase(prev => ({ ...prev, ...updateData }));
        await updateCaseInFirestore(selectedCase.id, updateData);
    };

    const handleRadicadoSICChange = (e) => { setSelectedCase(prev => ({ ...prev, Radicado_SIC: e.target.value })); updateCaseInFirestore(selectedCase.id, { Radicado_SIC: e.target.value }); };
    const handleFechaVencimientoDecretoChange = (e) => { setSelectedCase(prev => ({ ...prev, Fecha_Vencimiento_Decreto: e.target.value })); updateCaseInFirestore(selectedCase.id, { Fecha_Vencimiento_Decreto: e.target.value }); };
    const handleAssignUser = async () => { if (!selectedCase || !userId) return; setSelectedCase(prev => ({ ...prev, user: userId })); await updateCaseInFirestore(selectedCase.id, { user: userId }); displayModalMessage(`Caso asignado a: ${userId}`); };
    const generateAIAnalysis = async () => { if (!selectedCase) return; setIsGeneratingAnalysis(true); try { const res = await getAIAnalysisAndCategory(selectedCase); setSelectedCase(prev => ({ ...prev, ...res })); await updateCaseInFirestore(selectedCase.id, res); } catch (e) { displayModalMessage(`Error AI Analysis: ${e.message}`); } finally { setIsGeneratingAnalysis(false); }};
    const generateAISummaryHandler = async () => { if (!selectedCase) return; setIsGeneratingSummary(true); try { const sum = await getAISummary(selectedCase); setSelectedCase(prev => ({ ...prev, Resumen_Hechos_IA: sum })); await updateCaseInFirestore(selectedCase.id, { Resumen_Hechos_IA: sum }); } catch (e) { displayModalMessage(`Error AI Summary: ${e.message}`); } finally { setIsGeneratingSummary(false); }};
    const generateAIResponseProjectionHandler = async () => {
        if (!selectedCase) return;
        const lastObs = selectedCase.Observaciones_Historial?.slice(-1)[0]?.text || selectedCase.Observaciones || '';
        setIsGeneratingResponseProjection(true);
        try { const proj = await getAIResponseProjection(lastObs, selectedCase, selectedCase.Tipo_Contrato || 'Condiciones Uniformes'); setSelectedCase(prev => ({ ...prev, Proyeccion_Respuesta_IA: proj })); await updateCaseInFirestore(selectedCase.id, { Proyeccion_Respuesta_IA: proj }); }
        catch (e) { displayModalMessage(`Error AI Projection: ${e.message}`); }
        finally { setIsGeneratingResponseProjection(false); }
    };

    const handleSuggestEscalation = async () => {
        if (!selectedCase) return;
        setIsSuggestingEscalation(true);
        displayModalMessage('La IA está sugiriendo una escalación...');
        try {
            const suggestion = await getAIEscalationSuggestion(selectedCase);
            if (suggestion.area && suggestion.motivo) {
                const firestoreUpdateData = {
                    areaEscalada: suggestion.area,
                    motivoEscalado: suggestion.motivo,
                };
                setSelectedCase(prev => ({ ...prev, ...firestoreUpdateData }));
                await updateCaseInFirestore(selectedCase.id, firestoreUpdateData);
                displayModalMessage('Sugerencia de escalación aplicada.');
            } else {
                displayModalMessage('No se pudo obtener una sugerencia válida de la IA.');
            }
        } catch (e) {
            displayModalMessage(`Error con la IA: ${e.message}`);
        } finally {
            setIsSuggestingEscalation(false);
        }
    };


    const handleObservationsChange = (e) => setSelectedCase(prev => ({ ...prev, Observaciones: e.target.value }));
    const saveObservation = async () => { if (!selectedCase || !selectedCase.Observaciones?.trim()) { displayModalMessage('Escriba observación.'); return; } const newHist = { text: selectedCase.Observaciones.trim(), timestamp: new Date().toISOString() }; const updatedHist = [...(selectedCase.Observaciones_Historial || []), newHist]; setSelectedCase(prev => ({ ...prev, Observaciones_Historial: updatedHist, Observaciones: '' })); await updateCaseInFirestore(selectedCase.id, { Observaciones_Historial: updatedHist, Observaciones: '' }); displayModalMessage('Observación guardada.'); };
    const handleFechaCierreChange = (e) => { setSelectedCase(prev => ({ ...prev, 'Fecha Cierre': e.target.value })); updateCaseInFirestore(selectedCase.id, { 'Fecha Cierre': e.target.value }); };
    
    const handleManualFormChange = (e) => { 
        const { name, value, type, checked } = e.target; 
        let fVal = type === 'checkbox' ? checked : value;
        if (name === 'Nro_Nuip_Cliente' && (value.startsWith('8') || value.startsWith('9')) && value.length > 9) fVal = value.substring(0,9); 
        else if (name === 'Nombre_Cliente') fVal = value.toUpperCase(); 
        
        setManualFormData(prev => {
            const newState = {...prev, [name]: fVal};
            if (name === 'Requiere_Aseguramiento_Facturas' && !fVal) {
                newState.ID_Aseguramiento = ''; newState.Corte_Facturacion = ''; newState.Cuenta = '';
                newState.Operacion_Aseguramiento = ''; newState.Tipo_Aseguramiento = ''; newState.Mes_Aseguramiento = '';
            }
            if (name === 'requiereBaja' && !fVal) newState.numeroOrdenBaja = '';
            if (name === 'requiereAjuste' && !fVal) {
                newState.numeroTT = ''; newState.estadoTT = ''; newState.requiereDevolucionDinero = false;
                newState.cantidadDevolver = ''; newState.idEnvioDevoluciones = ''; newState.fechaEfectivaDevolucion = '';
            }
            if (name === 'requiereDevolucionDinero' && !fVal) { 
                newState.cantidadDevolver = ''; newState.idEnvioDevoluciones = ''; newState.fechaEfectivaDevolucion = '';
            }
            if (name === 'areaEscalada') {
                newState.motivoEscalado = '';
            }
            if (name === 'Tipo_Contrato' && value !== 'Contrato Marco') {
                newState.Numero_Contrato_Marco = '';
            }
            return newState;
        }); 
    };

    const handleManualSubmit = async (e) => {
        e.preventDefault(); setUploading(true); displayModalMessage('Procesando manual con IA...');
        try {
            if (manualFormData.requiereBaja && !manualFormData.numeroOrdenBaja) {
                displayModalMessage('Si requiere baja, debe ingresar el Número de Orden de Baja.'); setUploading(false); return;
            }
            if (manualFormData.requiereAjuste) {
                if (!manualFormData.numeroTT) {
                    displayModalMessage('Si requiere ajuste, debe ingresar el Número de TT.'); setUploading(false); return;
                }
                if (!manualFormData.estadoTT) { 
                    displayModalMessage('Si requiere ajuste, debe seleccionar un Estado para el TT.'); setUploading(false); return;
                }
                if (manualFormData.requiereDevolucionDinero) {
                    if (!manualFormData.cantidadDevolver || isNaN(parseFloat(manualFormData.cantidadDevolver)) || parseFloat(manualFormData.cantidadDevolver) <= 0) {
                        displayModalMessage('Si requiere devolución de dinero, la "Cantidad a Devolver" debe ser un número válido y mayor a cero.'); setUploading(false); return;
                    }
                    if (!manualFormData.idEnvioDevoluciones) { displayModalMessage('Si requiere devolución de dinero, debe ingresar el "ID Envío Devoluciones".'); setUploading(false); return; }
                    if (!manualFormData.fechaEfectivaDevolucion) { displayModalMessage('Si requiere devolución de dinero, debe ingresar la "Fecha Efectiva Devolución".'); setUploading(false); return; }
                }
            }
            if (manualFormData.Estado_Gestion === 'Escalado') {
                if (!manualFormData.areaEscalada) { displayModalMessage('Si el estado es "Escalado", debe seleccionar un Área Escalada.'); setUploading(false); return; }
                if (!manualFormData.motivoEscalado) { displayModalMessage('Si el estado es "Escalado", debe seleccionar un Motivo de Escalado.'); setUploading(false); return; }
            }

            const today = getColombianDateISO();
            const collRef = collection(db, `artifacts/${appId}/users/${userId}/cases`);
            
            const currentSN = String(manualFormData.SN || '').trim();
            if (currentSN) {
                const existingDocs = await getDocs(query(collRef, where('SN', '==', currentSN)));
                if (!existingDocs.empty) {
                    displayModalMessage(`Error: El SN "${currentSN}" ya existe. No se agregó el caso manual.`);
                    setUploading(false);
                    return;
                }
            }
            
            const aiData = { SN: manualFormData.SN, FechaRadicado: manualFormData.FechaRadicado, Nombre_Cliente: manualFormData.Nombre_Cliente, obs: manualFormData.OBS, type_request: manualFormData.type_request || '' };
            let aiAnalysisCat = { 'Analisis de la IA': 'N/A', 'Categoria del reclamo': 'N/A' }, aiPrio = 'Media', relNum = 'N/A';
            try { aiAnalysisCat = await getAIAnalysisAndCategory(aiData); aiPrio = await getAIPriority(manualFormData.OBS); relNum = extractRelatedComplaintNumber(manualFormData.OBS); } catch (aiErr) { console.error(`AI Error manual SN ${currentSN || 'N/A'}:`, aiErr); }
            
            let estadoGestionInicial = manualFormData.Estado_Gestion || 'Pendiente';
            if (manualFormData.requiereAjuste && manualFormData.estadoTT === 'Pendiente' && estadoGestionInicial !== 'Escalado') {
                estadoGestionInicial = 'Pendiente Ajustes';
            }

            const newCase = { 
                ...manualFormData, 
                user: userId,
                Estado_Gestion: estadoGestionInicial, 
                ...aiAnalysisCat, Prioridad: aiPrio, 
                Numero_Reclamo_Relacionado: relNum, 
                Observaciones_Reclamo_Relacionado: '',
                Aseguramiento_Historial: [],
                Escalamiento_Historial: [],
                Resumen_Hechos_IA: 'No generado', 
                Proyeccion_Respuesta_IA: 'No generada', 
                fecha_asignacion: today, Observaciones_Historial: [], 
                SNAcumulados_Historial: [],
                Despacho_Respuesta_Checked: false, Fecha_Inicio_Gestion: '', 
                Tiempo_Resolucion_Minutos: 'N/A', Radicado_SIC: '', Fecha_Vencimiento_Decreto: '',
            };
            if (newCase.Estado_Gestion !== 'Escalado') {
                newCase.areaEscalada = ''; newCase.motivoEscalado = ''; 
                newCase.idEscalado = ''; newCase.reqGenerado = '';
                newCase.descripcionEscalamiento = '';
            }

            await addDoc(collRef, newCase);
            displayModalMessage('Caso manual agregado con IA.'); 
            setShowManualEntryModal(false);
            setManualFormData(initialManualFormData); 
        } catch (err) { displayModalMessage(`Error manual: ${err.message}`); }
        finally { setUploading(false); }
    };

    const exportCasesToCSV = (isTodayResolvedOnly = false) => {
        const today = getColombianDateISO();
        const casesToExport = isTodayResolvedOnly 
            ? cases.filter(c => (c.Estado_Gestion === 'Resuelto' || c.Estado_Gestion === 'Finalizado') && c['Fecha Cierre'] === today)
            : cases;

        if (casesToExport.length === 0) { displayModalMessage(isTodayResolvedOnly ? 'No hay casos resueltos o finalizados hoy.' : 'No hay casos para exportar.'); return; }
        
        const baseHeaders = [
            'SN','CUN','Fecha Radicado','Fecha Cierre','Dia','Dia_Original_CSV','fecha_asignacion','Nombre_Cliente','Estado','Estado_Gestion',
            'Nivel_1','Nivel_2','Nivel_3','Nivel_4','Nivel_5','Analisis de la IA','Categoria del reclamo','Prioridad',
            'Resumen_Hechos_IA','Proyeccion_Respuesta_IA', 'Tipo_Contrato', 'Numero_Contrato_Marco', 'Observaciones','Observaciones_Historial', 'SNAcumulados_Historial', 'Escalamiento_Historial',
            'Numero_Reclamo_Relacionado', 'Observaciones_Reclamo_Relacionado', 'Aseguramiento_Historial',
            'Despacho_Respuesta_Checked', 'Requiere_Aseguramiento_Facturas', 'ID_Aseguramiento', 
            'Corte_Facturacion', 'Cuenta', 'Operacion_Aseguramiento', 'Tipo_Aseguramiento', 'Mes_Aseguramiento',
            'Fecha_Inicio_Gestion','Tiempo_Resolucion_Minutos','Radicado_SIC','Fecha_Vencimiento_Decreto',
            'Tipo_Nuip_Cliente','Nro_Nuip_Cliente','Correo_Electronico_Cliente','Direccion_Cliente','Ciudad_Cliente','Depto_Cliente',
            'Nombre_Reclamante','Tipo_Nuip_Reclamante','Nro_Nuip_Reclamante','Correo_Electronico_Reclamante','Direccion_Reclamante',
            'Ciudad_Reclamante','Depto_Reclamante','favorabilidad','HandleNumber','AcceptStaffNo','type_request','obs',
            'Despacho_Fisico','Despacho_Electronico','Contacto_Cliente','nombre_oficina','Tipopago','date_add','Tipo_Operacion',
            'Ultima Modificacion','Fecha Cargue Planilla','Usuario Cargue Planilla','Fecha Pre-cierre Fullstack','Fecha Planilla Masivo',
            'Novedad Despacho','Clasificacion','Documento_Adjunto',
            'requiereBaja', 'numeroOrdenBaja', 'requiereAjuste', 'numeroTT', 'estadoTT', 'requiereDevolucionDinero',
            'cantidadDevolver', 'idEnvioDevoluciones', 'fechaEfectivaDevolucion',
            'areaEscalada', 'motivoEscalado', 'idEscalado', 'reqGenerado', 'descripcionEscalamiento'
        ];
        const dynamicHeaders = Array.from(new Set(casesToExport.flatMap(c => Object.keys(c))));
        const finalHeaders = Array.from(new Set(baseHeaders.concat(dynamicHeaders)));
        
        let csv = finalHeaders.map(h => `"${h}"`).join(',') + '\n';
        casesToExport.forEach(c => { csv += finalHeaders.map(h => { let v = c[h] ?? ''; if (typeof v === 'object') v = JSON.stringify(v); return `"${String(v).replace(/"/g, '""')}"`; }).join(',') + '\n'; });
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            link.href = URL.createObjectURL(blob);
            link.download = `casos_resueltos_y_finalizados_hoy_${today}.csv`;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        } else { displayModalMessage('Descarga no soportada. Copia manual.'); console.log(csv); }
    };

    const lowerSearch = searchTerm.toLowerCase();
    const searchedCases = cases.filter(c => 
        ['SN','CUN','Nro_Nuip_Cliente','Nombre_Cliente', 'Categoria del reclamo', 'Prioridad'].some(f => 
            String(c[f]||'').toLowerCase().includes(lowerSearch)
        )
    );

    const applyActiveFilter = (cs) => {
        const pendStates = ['Pendiente','Escalado','Iniciado','Lectura','Traslado SIC','Decretado', 'Pendiente Ajustes']; 
        switch(activeFilter){
            case 'all': return cs;
            case 'resolved': return cs.filter(c => c.Estado_Gestion === 'Resuelto');
            case 'finalizado': return cs.filter(c => c.Estado_Gestion === 'Finalizado');
            case 'pending_escalated_initiated': return cs.filter(c => pendStates.includes(c.Estado_Gestion));
            case 'decretado': return cs.filter(c => c.Estado_Gestion === 'Decretado' || c.Estado_Gestion === 'Traslado SIC');
            case 'pendiente_ajustes': return cs.filter(c => c.Estado_Gestion === 'Pendiente Ajustes'); 
            case 'dia14_pending': return cs.filter(c => pendStates.includes(c.Estado_Gestion) && parseInt(calculateCaseAge(c)) === 14);
            case 'dia15_pending': return cs.filter(c => pendStates.includes(c.Estado_Gestion) && parseInt(calculateCaseAge(c)) === 15);
            case 'dia_gt15_pending': return cs.filter(c => pendStates.includes(c.Estado_Gestion) && parseInt(calculateCaseAge(c)) > 15);
            case 'resolved_today': return cs.filter(c => (c.Estado_Gestion === 'Resuelto' || c.Estado_Gestion === 'Finalizado') && c['Fecha Cierre'] === getColombianDateISO());
            default: return cs;
        }
    };
    const filteredAndSearchedCases = applyActiveFilter(searchedCases);
    const sortSN = (a,b) => String(a.SN||'').toLowerCase().localeCompare(String(b.SN||'').toLowerCase());
    
    const sicDisp = filteredAndSearchedCases.filter(c => (c.Estado_Gestion === 'Decretado' || c.Estado_Gestion === 'Traslado SIC') && c.user === userId).sort(sortSN);
    const pendAjustesDisp = filteredAndSearchedCases.filter(c => c.Estado_Gestion === 'Pendiente Ajustes' && c.user === userId).sort(sortSN); 
    const pendEscDisp = filteredAndSearchedCases.filter(c => ['Pendiente','Escalado','Iniciado','Lectura'].includes(c.Estado_Gestion) && c.user === userId).sort(sortSN);
    const resDisp = filteredAndSearchedCases.filter(c => c.Estado_Gestion === 'Resuelto' && c.user === userId).sort(sortSN);
    const finalizadosDisp = filteredAndSearchedCases.filter(c => c.Estado_Gestion === 'Finalizado' && c.user === userId).sort(sortSN);
    const aseguramientosDisp = filteredAndSearchedCases.filter(c => (c.Estado_Gestion === 'Resuelto' || c.Estado_Gestion === 'Finalizado') && Array.isArray(c.Aseguramiento_Historial) && c.Aseguramiento_Historial.length > 0).sort(sortSN);
    
    const counts = {
        total: cases.length,
        resolved: cases.filter(c => c.Estado_Gestion === 'Resuelto').length,
        finalizado: cases.filter(c => c.Estado_Gestion === 'Finalizado').length,
        pending: cases.filter(c => ['Pendiente','Escalado','Iniciado','Lectura','Decretado','Traslado SIC', 'Pendiente Ajustes'].includes(c.Estado_Gestion)).length, 
        pendienteAjustes: cases.filter(c => c.Estado_Gestion === 'Pendiente Ajustes').length, 
        dia14: cases.filter(c => ['Pendiente','Escalado','Iniciado','Lectura','Decretado','Traslado SIC', 'Pendiente Ajustes'].includes(c.Estado_Gestion) && parseInt(calculateCaseAge(c)) === 14).length,
        dia15: cases.filter(c => ['Pendiente','Escalado','Iniciado','Lectura','Decretado','Traslado SIC', 'Pendiente Ajustes'].includes(c.Estado_Gestion) && parseInt(calculateCaseAge(c)) === 15).length,
        diaGt15: cases.filter(c => ['Pendiente','Escalado','Iniciado','Lectura','Decretado','Traslado SIC', 'Pendiente Ajustes'].includes(c.Estado_Gestion) && parseInt(calculateCaseAge(c)) > 15).length,
        resolvedToday: cases.filter(c => (c.Estado_Gestion === 'Resuelto' || c.Estado_Gestion === 'Finalizado') && c['Fecha Cierre'] === getColombianDateISO()).length,
    };

    const handleSelectCase = (caseId, isMassSelect) => {
        setSelectedCaseIds(prevSelectedIds => {
            const newSelectedIds = new Set(prevSelectedIds);
            if (isMassSelect) {
                return caseId; // caseId is the new Set in this case
            }
            if (newSelectedIds.has(caseId)) {
                newSelectedIds.delete(caseId);
            } else {
                newSelectedIds.add(caseId);
            }
            return newSelectedIds;
        });
    };
    
    const handleMassUpdate = async () => {
        if (!db || !userId || selectedCaseIds.size === 0 || !massUpdateTargetStatus) {
            displayModalMessage('Seleccione casos y un estado destino para la actualización masiva.');
            return;
        }

        setIsMassUpdating(true);
        displayModalMessage(`Actualizando ${selectedCaseIds.size} casos a estado "${massUpdateTargetStatus}"...`);

        if (massUpdateTargetStatus === 'Resuelto') {
            const casesToUpdate = cases.filter(c => selectedCaseIds.has(c.id));
            const notReadyForResolved = casesToUpdate.filter(c => !c.Despacho_Respuesta_Checked);
            if (notReadyForResolved.length > 0) {
                const snList = notReadyForResolved.map(c => c.SN).join(', ');
                displayModalMessage(`Error: Para cambiar masivamente a "Resuelto", todos los casos seleccionados deben tener "Despacho Respuesta" confirmado. Casos sin confirmar: ${snList}`);
                setIsMassUpdating(false);
                return;
            }
        }

        const batch = writeBatch(db);
        const today = getColombianDateISO();
        const nowISO = new Date().toISOString();

        selectedCaseIds.forEach(caseId => {
            const caseDocRef = doc(db, `artifacts/${appId}/users/${userId}/cases`, caseId);
            const updateData = { Estado_Gestion: massUpdateTargetStatus };
            const currentCase = cases.find(c => c.id === caseId);

            if (massUpdateTargetStatus === 'Iniciado') {
                updateData.Fecha_Inicio_Gestion = nowISO;
                updateData.Tiempo_Resolucion_Minutos = 'N/A';
                if (currentCase && currentCase.Estado_Gestion === 'Iniciado') { sessionStorage.removeItem(`iniciadoAlertShown_${caseId}`); }
            } else if (massUpdateTargetStatus === 'Resuelto') {
                updateData['Fecha Cierre'] = today;
                if (currentCase && currentCase.Fecha_Inicio_Gestion) {
                    updateData.Tiempo_Resolucion_Minutos = getDurationInMinutes(currentCase.Fecha_Inicio_Gestion, nowISO);
                } else {
                    updateData.Tiempo_Resolucion_Minutos = 'N/A';
                }
            }
            if (currentCase && currentCase.Estado_Gestion === 'Escalado' && massUpdateTargetStatus !== 'Escalado') {
                updateData.areaEscalada = ''; updateData.motivoEscalado = ''; updateData.idEscalado = ''; updateData.reqGenerado = '';
            }
            if (currentCase && currentCase.Estado_Gestion === 'Iniciado' && massUpdateTargetStatus !== 'Iniciado') {
                sessionStorage.removeItem(`iniciadoAlertShown_${caseId}`);
            }
            batch.update(caseDocRef, updateData);
        });

        try {
            await batch.commit();
            displayModalMessage(`${selectedCaseIds.size} casos actualizados exitosamente a "${massUpdateTargetStatus}".`);
            setSelectedCaseIds(new Set());
            setMassUpdateTargetStatus('');
        } catch (error) {
            console.error("Error en actualización masiva:", error);
            displayModalMessage(`Error al actualizar casos masivamente: ${error.message}`);
        } finally {
            setIsMassUpdating(false);
        }
    };

    const handleReopenCase = async (caseItem) => {
        if (!db || !userId || caseItem.Estado_Gestion !== 'Resuelto') return;
        const caseId = caseItem.id;
        const updateData = { Estado_Gestion: 'Pendiente', 'Fecha Cierre': '', Tiempo_Resolucion_Minutos: 'N/A' };
        try {
            await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/cases`, caseId), updateData);
            setSelectedCase(prev => ({ ...prev, ...updateData }));
            displayModalMessage('Caso reabierto exitosamente.');
        } catch (error) {
            displayModalMessage(`Error al reabrir el caso: ${error.message}`);
        }
    };

    const handleDeleteCase = (caseId) => {
        const onConfirm = async () => {
            if (!db || !userId) { displayModalMessage('Error: DB no disponible.'); return; }
            try {
                await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/cases`, caseId));
                displayModalMessage('Caso eliminado exitosamente.');
                handleCloseCaseDetails();
            } catch (error) {
                displayModalMessage(`Error al eliminar el caso: ${error.message}`);
            }
        };
        displayConfirmModal('¿Estás seguro de que quieres eliminar este caso de forma permanente? Esta acción no se puede deshacer.', {onConfirm});
    };

    const handleMassDelete = () => {
        if (selectedCaseIds.size === 0) { displayModalMessage('No hay casos seleccionados para eliminar.'); return; }
        const onConfirm = async () => {
            setIsMassUpdating(true);
            displayModalMessage(`Eliminando ${selectedCaseIds.size} casos...`);
            const batch = writeBatch(db);
            selectedCaseIds.forEach(caseId => {
                const caseDocRef = doc(db, `artifacts/${appId}/users/${userId}/cases`, caseId);
                batch.delete(caseDocRef);
            });
            try {
                await batch.commit();
                displayModalMessage(`${selectedCaseIds.size} casos eliminados exitosamente.`);
                setSelectedCaseIds(new Set());
            } catch (error) {
                displayModalMessage(`Error al eliminar masivamente: ${error.message}`);
            } finally {
                setIsMassUpdating(false);
            }
        };
        displayConfirmModal(`¿Estás seguro de que quieres eliminar ${selectedCaseIds.size} casos permanentemente? Esta acción no se puede deshacer.`, {onConfirm});
    };

    const handleMassReopen = () => {
        if (selectedCaseIds.size === 0) { displayModalMessage('No hay casos seleccionados para reabrir.'); return; }
        const casesToReopen = cases.filter(c => selectedCaseIds.has(c.id) && c.Estado_Gestion === 'Resuelto');
        if (casesToReopen.length === 0) { displayModalMessage('Ninguno de los casos seleccionados está "Resuelto". Solo los casos resueltos pueden ser reabiertos.'); return; }
        const onConfirm = async () => {
            setIsMassUpdating(true);
            displayModalMessage(`Reabriendo ${casesToReopen.length} casos...`);
            const batch = writeBatch(db);
            const updateData = { Estado_Gestion: 'Pendiente', 'Fecha Cierre': '', Tiempo_Resolucion_Minutos: 'N/A' };
            casesToReopen.forEach(caseItem => {
                const caseDocRef = doc(db, `artifacts/${appId}/users/${userId}/cases`, caseItem.id);
                batch.update(caseDocRef, updateData);
            });
            try {
                await batch.commit();
                displayModalMessage(`${casesToReopen.length} casos reabiertos exitosamente.`);
                setSelectedCaseIds(new Set());
            } catch (error) {
                displayModalMessage(`Error al reabrir masivamente: ${error.message}`);
            } finally {
                setIsMassUpdating(false);
            }
        };
        displayConfirmModal(`Se reabrirán ${casesToReopen.length} de los ${selectedCaseIds.size} casos seleccionados (solo los que están en estado "Resuelto"). ¿Continuar?`, {onConfirm});
    };

    const handleSNAcumuladoInputChange = (index, field, value) => {
        const newData = [...snAcumuladosData];
        newData[index][field] = value;
        setSnAcumuladosData(newData);
    };

    const handleSaveSNAcumulados = async () => {
        if (!selectedCase || snAcumuladosData.some(item => !item.sn.trim())) {
            displayModalMessage('Todos los campos de SN acumulados deben estar llenos antes de guardar.');
            return;
        }

        const newHistory = snAcumuladosData.map(item => ({
            sn: item.sn,
            obs: item.obs,
            timestamp: new Date().toISOString()
        }));

        const updatedHistory = [...(selectedCase.SNAcumulados_Historial || []), ...newHistory];

        try {
            await updateCaseInFirestore(selectedCase.id, { SNAcumulados_Historial: updatedHistory });
            setSelectedCase(prev => ({ ...prev, SNAcumulados_Historial: updatedHistory }));
            displayModalMessage('SN Acumulados guardados exitosamente.');
            // Reset fields after saving
            setCantidadSNAcumulados(0);
            setSnAcumuladosData([]);
            setTieneSNAcumulados(false);
        } catch (error) {
            displayModalMessage(`Error al guardar SN Acumulados: ${error.message}`);
        }
    };
    
    const handleSaveAseguramientoHistory = async () => {
        if (!selectedCase) return;
        const assuranceData = {
            timestamp: new Date().toISOString(),
            observaciones: aseguramientoObs,
            Requiere_Aseguramiento_Facturas: selectedCase.Requiere_Aseguramiento_Facturas || false,
            ID_Aseguramiento: selectedCase.ID_Aseguramiento || '',
            Corte_Facturacion: selectedCase.Corte_Facturacion || '',
            Cuenta: selectedCase.Cuenta || '',
            Operacion_Aseguramiento: selectedCase.Operacion_Aseguramiento || '',
            Tipo_Aseguramiento: selectedCase.Tipo_Aseguramiento || '',
            Mes_Aseguramiento: selectedCase.Mes_Aseguramiento || '',
            requiereBaja: selectedCase.requiereBaja || false,
            numeroOrdenBaja: selectedCase.numeroOrdenBaja || '',
            requiereAjuste: selectedCase.requiereAjuste || false,
            numeroTT: selectedCase.numeroTT || '',
            estadoTT: selectedCase.estadoTT || '',
            requiereDevolucionDinero: selectedCase.requiereDevolucionDinero || false,
            cantidadDevolver: selectedCase.cantidadDevolver || '',
            idEnvioDevoluciones: selectedCase.idEnvioDevoluciones || '',
            fechaEfectivaDevolucion: selectedCase.fechaEfectivaDevolucion || ''
        };

        const newHistory = [...(selectedCase.Aseguramiento_Historial || []), assuranceData];
        try {
            await updateCaseInFirestore(selectedCase.id, { Aseguramiento_Historial: newHistory });
            setSelectedCase(prev => ({ ...prev, Aseguramiento_Historial: newHistory }));
            displayModalMessage('Historial de aseguramiento guardado.');
            setAseguramientoObs('');
        } catch(e) {
            displayModalMessage(`Error guardando historial: ${e.message}`);
        }
    }

    const handleScanClick = (caseItem) => {
        setCaseToScan(caseItem);
        scanFileInputRef.current.click();
    };

    const handleScanFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file || !caseToScan) return;
    
        setIsScanning(true);
        displayModalMessage(`Transcribiendo documento para SN: ${caseToScan.SN}...`);
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64ImageData = reader.result.split(',')[1];
            const prompt = "Transcribe el texto de esta imagen del documento.";
            
            const payload = {
              contents: [
                    {
                        role: "user",
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: file.type, 
                                    data: base64ImageData
                                }
                            }
                        ]
                    }
                ],
            };
    
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                
                if (response.ok && result.candidates && result.candidates[0].content.parts.length > 0) {
                    const transcribedText = result.candidates[0].content.parts[0].text;
                    const updatedObs = `${caseToScan.obs || ''}\n\n--- INICIO TRANSCRIPCIÓN ---\n${transcribedText}\n--- FIN TRANSCRIPCIÓN ---`;
                    
                    await updateCaseInFirestore(caseToScan.id, {
                        obs: updatedObs,
                        Documento_Adjunto: 'Transcrito' 
                    });
    
                    displayModalMessage('Transcripción completada y añadida a las observaciones.');
                } else {
                    throw new Error(result.error?.message || 'No se pudo transcribir el documento.');
                }
            } catch (error) {
                console.error("Error transcribing document:", error);
                displayModalMessage(`Error en la transcripción: ${error.message}`);
            } finally {
                setIsScanning(false);
                setCaseToScan(null);
                if (scanFileInputRef.current) {
                    scanFileInputRef.current.value = "";
                }
            }
        };
        reader.onerror = (error) => {
            console.error("Error reading file:", error);
            displayModalMessage("Error al leer el archivo.");
            setIsScanning(false);
        };
    };

    useEffect(() => {
        if (cantidadSNAcumulados > 0) {
            setSnAcumuladosData(Array.from({ length: cantidadSNAcumulados }, () => ({ sn: '', obs: '' })));
        } else {
            setSnAcumuladosData([]);
        }
    }, [cantidadSNAcumulados]);


    if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-lg">Cargando...</div></div>;

    const renderTable = (data, title) => {
        return (
            <PaginatedTable
                cases={data}
                title={title}
                mainTableHeaders={MAIN_TABLE_HEADERS}
                statusColors={statusColors}
                priorityColors={priorityColors}
                selectedCaseIds={selectedCaseIds}
                handleSelectCase={handleSelectCase}
                handleOpenCaseDetails={handleOpenCaseDetails}
                calculateCaseAge={calculateCaseAge}
                onScanClick={handleScanClick}
            />
        );
    };

    return (
        <div className="min-h-screen bg-gray-100 p-4 font-sans flex flex-col items-center">
            <input
                type="file"
                ref={scanFileInputRef}
                onChange={handleScanFileUpload}
                accept="image/png, image/jpeg"
                style={{ display: 'none' }}
            />
            <div className="w-full max-w-7xl bg-white shadow-lg rounded-lg p-6"> 
                <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">Seguimiento de Casos Asignados</h1>
                <div className="flex justify-center gap-4 mb-6">
                    <button onClick={() => setActiveModule('casos')} className={`px-6 py-2 rounded-lg font-semibold ${activeModule === 'casos' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                        Casos
                    </button>
                    <button onClick={() => setActiveModule('aseguramientos')} className={`px-6 py-2 rounded-lg font-semibold ${activeModule === 'aseguramientos' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                        Aseguramientos
                    </button>
                </div>
                
                {userId && <p className="text-sm text-center mb-4">User ID: <span className="font-mono bg-gray-200 px-1 rounded">{userId}</span></p>}
                <p className="text-lg text-center mb-4">Fecha y Hora: {currentDateTime.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>
                <input type="text" placeholder="Buscar SN, CUN, Nuip, Nombre, Categoría Reclamo..." value={searchTerm} onChange={e=>{setSearchTerm(e.target.value);setActiveFilter('all')}} className="p-3 mb-6 border rounded-lg w-full shadow-sm"/>
                
                {selectedCaseIds.size > 0 && (
                    <div className="my-6 p-4 border border-blue-300 bg-blue-50 rounded-lg shadow-md">
                        <h3 className="text-lg font-semibold text-blue-700 mb-3">{selectedCaseIds.size} caso(s) seleccionado(s)</h3>
                        <div className="flex flex-wrap items-center gap-3">
                            <select 
                                value={massUpdateTargetStatus} 
                                onChange={(e) => setMassUpdateTargetStatus(e.target.value)}
                                className="p-2 border rounded-md shadow-sm flex-grow"
                            >
                                <option value="">Seleccionar Nuevo Estado...</option>
                                {ALL_STATUS_OPTIONS.map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                            <button 
                                onClick={handleMassUpdate} 
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 shadow-md disabled:opacity-50"
                                disabled={!massUpdateTargetStatus || isMassUpdating}
                            >
                                {isMassUpdating ? 'Procesando...' : 'Cambiar Estado'}
                            </button>
                             <button
                                onClick={handleMassReopen}
                                className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 shadow-md disabled:opacity-50"
                                disabled={isMassUpdating}
                            >
                                {isMassUpdating ? 'Procesando...' : 'Reabrir'}
                            </button>
                            <button
                                onClick={handleMassDelete}
                                className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-800 shadow-md disabled:opacity-50"
                                disabled={isMassUpdating}
                            >
                                {isMassUpdating ? 'Procesando...' : 'Eliminar'}
                            </button>
                        </div>
                        {massUpdateTargetStatus === 'Resuelto' && (
                             <p className="text-xs text-orange-600 mt-2">
                                 Advertencia: Al cambiar masivamente a "Resuelto", asegúrese de que todos los casos seleccionados deben tener "Despacho Respuesta" confirmado.
                                 Otros campos como Aseguramiento, Baja, o Ajuste no se validan en esta acción masiva y deben gestionarse individualmente si es necesario antes de resolver.
                            </p>
                        )}
                    </div>
                )}

                {activeModule === 'casos' && (
                    <>
                        <div className="mb-8">
                             <div className="flex flex-col md:flex-row items-center gap-4 mb-4">
                                <div className="p-4 border rounded-lg bg-blue-50 w-full md:w-auto flex-shrink-0">
                                    <h2 className="font-bold text-lg mb-2 text-blue-800">Cargar CSV</h2>
                                    <input type="file" accept=".csv" onChange={handleFileUpload} ref={fileInputRef} className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200" disabled={uploading}/>
                                    {uploading && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <p className="text-xs text-blue-600">Cargando...</p>
                                            <button onClick={() => { cancelUpload.current = true; }} className="px-2 py-1 bg-red-500 text-white rounded-md text-xs hover:bg-red-600">
                                                Cancelar
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-wrap justify-center gap-2">
                                    <button onClick={()=>setShowManualEntryModal(true)} className="px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75">Ingresar Manual</button>
                                    <button onClick={forceRefreshCases} className="px-5 py-2 bg-teal-500 text-white font-semibold rounded-lg shadow-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-opacity-75" disabled={refreshing}>
                                        {refreshing ? 'Actualizando...' : 'Refrescar Casos'}
                                    </button>
                                    <button onClick={()=>exportCasesToCSV(false)} className="px-5 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75">Exportar Todos</button>
                                    <button onClick={()=>exportCasesToCSV(true)} className="px-5 py-2 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-opacity-75">Exportar Resueltos Hoy</button>
                                </div>
                            </div>
                             <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4"> 
                                {[
                                    {l:'Asignados',c:counts.total,f:'all',cl:'blue'},
                                    {l:'Resueltos',c:counts.resolved,f:'resolved',cl:'green'},
                                    {l:'Finalizados',c:counts.finalizado,f:'finalizado',cl:'gray'},
                                    {l:'Pendientes',c:counts.pending,f:'pending_escalated_initiated',cl:'yellow'},
                                    {l:'Pend. Ajustes',c:counts.pendienteAjustes,f:'pendiente_ajustes',cl:'pink'}, 
                                    {l:'Día 14 Pend.',c:counts.dia14,f:'dia14_pending',cl:'orange'},
                                    {l:'Día 15 Pend.',c:counts.dia15,f:'dia15_pending',cl:'red'},
                                    {l:'Día >15 Pend.',c:counts.diaGt15,f:'dia_gt15_pending',cl:'purple'}
                                ].map(s => (
                                    <div 
                                        key={s.f} 
                                        onClick={() => setActiveFilter(s.f)} 
                                        className={`p-3 rounded-lg shadow-sm text-center cursor-pointer border-2 ${activeFilter === s.f ? `border-${s.cl}-500 bg-${s.cl}-100` : `border-gray-200 bg-gray-50 hover:bg-gray-100`}`}
                                    >
                                        <p className={`text-sm font-semibold text-gray-700`}>{s.l}</p>
                                        <p className={`text-2xl font-bold text-${s.cl}-600`}>{s.c}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {activeFilter!=='all'&&<div className="mb-4 text-center"><button onClick={()=>{setActiveFilter('all'); setSelectedCaseIds(new Set());}} className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400">Limpiar Filtros y Selección</button></div>}
                        
                        {renderTable(sicDisp, 'Envíos SIC')}
                        {renderTable(pendAjustesDisp, 'Pendiente Ajustes')} 
                        {renderTable(pendEscDisp, 'Otros Casos Pendientes o Escalados')}
                        {renderTable(resDisp, 'Casos Resueltos')}
                        {renderTable(finalizadosDisp, 'Casos Finalizados')}
                        {filteredAndSearchedCases.length === 0 && <p className="p-6 text-center">No hay casos que coincidan.</p>}
                    </>
                )}
                 {activeModule === 'aseguramientos' && (
                    <>
                        {renderTable(aseguramientosDisp, 'Casos Resueltos con Aseguramiento')}
                    </>
                )}

            </div>

            {showModal && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                        <h3 className="text-lg font-semibold mb-4">Mensaje del Sistema</h3>
                        <p className="mb-6 whitespace-pre-line">{modalContent.message}</p>
                        <div className="flex justify-end gap-4">
                            {modalContent.isConfirm && (
                                <button 
                                    onClick={() => {
                                        if(modalContent.onConfirm) modalContent.onConfirm();
                                        setShowModal(false);
                                    }} 
                                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                >
                                    {modalContent.confirmText}
                                </button>
                            )}
                            <button 
                                onClick={() => {
                                    if(modalContent.onCancel) modalContent.onCancel();
                                    else setShowModal(false);
                                }} 
                                className={`px-4 py-2 rounded-md ${modalContent.isConfirm ? 'bg-gray-300 hover:bg-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                            >
                                {modalContent.cancelText || 'Cerrar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {selectedCase && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-4xl w-full mx-auto overflow-y-auto max-h-[90vh]"> 
                        <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">Detalles del Caso: {selectedCase.SN}</h3>
                        {duplicateCasesDetails.length > 0 && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"><strong className="font-bold">¡Alerta!</strong> {duplicateCasesDetails.length} casos relacionados.<ul className="mt-1 list-disc list-inside">{duplicateCasesDetails.map(d=><li key={d.id} className="text-sm">SN: {d.SN}, CUN: {d.CUN}, Cliente: {d.Nombre_Cliente} (por {d.type})</li>)}</ul></div>}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                            {MODAL_DISPLAY_HEADERS.map(header => {
                                const nonEditableFields = ['CUN', 'Fecha Radicado', 'fecha_asignacion', 'user', 'Estado_Gestion', 'Fecha_Inicio_Gestion', 'Tiempo_Resolucion_Minutos', 'Resumen_Hechos_IA', 'date_add'];
                                const dateFields = ['Fecha Cierre', 'Fecha_Vencimiento_Decreto', 'Fecha Vencimiento'];
                                const textAreaFields = ['obs', 'Analisis de la IA'];
                                
                                let isEditable = !nonEditableFields.includes(header);
                                if (header === 'SN' && selectedCase.Estado_Gestion !== 'Decretado') {
                                    isEditable = false;
                                }

                                const isDate = dateFields.includes(header);
                                const isTextArea = textAreaFields.includes(header);
                                
                                if (header === 'Tipo_Contrato') {
                                    return (
                                        <div key={header} className="bg-gray-50 p-3 rounded-md">
                                            <label htmlFor="modal-Tipo_Contrato" className="block text-sm font-semibold text-gray-700 mb-1">Tipo de Contrato:</label>
                                            <select id="modal-Tipo_Contrato" value={selectedCase.Tipo_Contrato || 'Condiciones Uniformes'} onChange={(e) => handleContractTypeChange(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2">
                                                <option value="Condiciones Uniformes">Condiciones Uniformes</option>
                                                <option value="Contrato Marco">Contrato Marco</option>
                                            </select>
                                        </div>
                                    );
                                }
                                
                                return (
                                    <React.Fragment key={header}>
                                    <div className={`bg-gray-50 p-3 rounded-md ${isTextArea || header === 'Resumen_Hechos_IA' || header === 'Observaciones_Reclamo_Relacionado' ? 'lg:col-span-3 md:col-span-2' : ''}`}>
                                        <label htmlFor={`modal-${header}`} className="block text-sm font-semibold text-gray-700 mb-1">{header.replace(/_/g, ' ')}:</label>
                                        { isEditable ? (
                                            <>
                                            <div className="relative">
                                                {isTextArea ? 
                                                    <textarea id={`modal-${header}`} rows={3} className="block w-full rounded-md p-2 pr-10" value={selectedCase[header]||''} onChange={e=>handleModalFieldChange(header,e.target.value)} /> 
                                                    : 
                                                    <input type={isDate?'date':'text'} id={`modal-${header}`} className="block w-full rounded-md p-2 pr-10" value={selectedCase[header]||''} onChange={e=>handleModalFieldChange(header,e.target.value)} />
                                                }
                                                {['obs', 'Analisis de la IA'].includes(header) && (
                                                    <button onClick={() => copyToClipboard(selectedCase[header] || '', header.replace(/_/g, ' '), displayModalMessage)} className="absolute top-1 right-1 p-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded" title={`Copiar ${header.replace(/_/g, ' ')}`}>Copiar</button>
                                                )}
                                            </div>
                                             {(header === 'obs' || header === 'Analisis de la IA') && (
                                                 <button onClick={generateAIAnalysis} className="mt-2 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50" disabled={isGeneratingAnalysis}>
                                                     {isGeneratingAnalysis ? 'Regenerando...' : 'Regenerar Análisis y Categoría'}
                                                 </button>
                                             )}
                                             </>
                                        )
                                        : header === 'user' ? (<div className="flex items-center gap-2"><input type="text" id="caseUser" value={selectedCase.user||''} readOnly className="block w-full rounded-md p-2 bg-gray-100"/><button onClick={handleAssignUser} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm">Asignar</button></div>)
                                        : header === 'Resumen_Hechos_IA' ? (
                                            <div className="relative">
                                                <textarea rows="3" className="block w-full rounded-md p-2 pr-10 bg-gray-100" value={selectedCase.Resumen_Hechos_IA||'No generado'} readOnly/>
                                                <button onClick={() => copyToClipboard(selectedCase.Resumen_Hechos_IA || '', 'Resumen Hechos IA', displayModalMessage)} className="absolute top-1 right-1 p-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded" title="Copiar Resumen Hechos IA">Copiar</button>
                                                <button onClick={generateAISummaryHandler} className="mt-2 px-3 py-1.5 bg-teal-600 text-white rounded-md text-sm" disabled={isGeneratingSummary}>{isGeneratingSummary?'Generando...':'Generar Resumen IA'}</button>
                                            </div>
                                        )
                                        : <p className={`text-base break-words`}>{selectedCase[header]||'N/A'}</p>}
                                    </div>
                                    {header === 'Numero_Reclamo_Relacionado' && selectedCase.Numero_Reclamo_Relacionado && selectedCase.Numero_Reclamo_Relacionado !== 'N/A' && (
                                         <div className="bg-gray-50 p-3 rounded-md lg:col-span-2 md:col-span-2">
                                             <label htmlFor="Observaciones_Reclamo_Relacionado" className="block text-sm font-semibold text-gray-700 mb-1">Observaciones del Reclamo Relacionado:</label>
                                             <textarea id="Observaciones_Reclamo_Relacionado" rows="3" className="block w-full rounded-md p-2" value={selectedCase.Observaciones_Reclamo_Relacionado || ''} onChange={e => handleModalFieldChange('Observaciones_Reclamo_Relacionado', e.target.value)} placeholder="Añadir observaciones sobre el reclamo relacionado..."/>
                                         </div>
                                    )}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                        
                        <div className="mt-4 mb-6 p-4 border border-orange-200 rounded-md bg-orange-50">
                            <h4 className="text-lg font-semibold text-orange-800 mb-3">Gestión de SN Acumulados</h4>
                            <div className="mb-3">
                                <label className="inline-flex items-center">
                                    <input type="checkbox" className="form-checkbox h-5 w-5 text-orange-600" checked={tieneSNAcumulados} onChange={(e) => { setTieneSNAcumulados(e.target.checked); if (!e.target.checked) setCantidadSNAcumulados(0); }} />
                                    <span className="ml-2 text-gray-700 font-medium">¿Tiene SN Acumulados?</span>
                                </label>
                            </div>

                            {tieneSNAcumulados && (
                                <div className="mb-4">
                                    <label htmlFor="cantidadSNAcumulados" className="block text-sm font-medium text-gray-700 mb-1">Cantidad de SN a acumular:</label>
                                    <select id="cantidadSNAcumulados" value={cantidadSNAcumulados} onChange={(e) => setCantidadSNAcumulados(Number(e.target.value))} className="block w-full max-w-xs input-form">
                                        <option value="0">Seleccione...</option>
                                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </div>
                            )}

                            {snAcumuladosData.map((item, index) => (
                                <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-3 border rounded-md bg-white">
                                    <div>
                                        <label htmlFor={`sn-acumulado-${index}`} className="block text-sm font-medium text-gray-700 mb-1">SN Acumulado {index + 1}:</label>
                                        <input type="text" id={`sn-acumulado-${index}`} value={item.sn} onChange={(e) => handleSNAcumuladoInputChange(index, 'sn', e.target.value)} className="block w-full input-form" placeholder="Ingrese el SN" required />
                                    </div>
                                    <div>
                                        <label htmlFor={`obs-acumulado-${index}`} className="block text-sm font-medium text-gray-700 mb-1">Observaciones SN {index + 1}:</label>
                                        <textarea id={`obs-acumulado-${index}`} value={item.obs} onChange={(e) => handleSNAcumuladoInputChange(index, 'obs', e.target.value)} className="block w-full input-form" rows="2" placeholder="Observaciones del SN acumulado" />
                                    </div>
                                </div>
                            ))}
                            
                            {cantidadSNAcumulados > 0 && (
                                <button onClick={handleSaveSNAcumulados} className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700" disabled={snAcumuladosData.some(item => !item.sn.trim())}>
                                    Guardar SN Acumulados
                                </button>
                            )}

                            <div className="mt-4">
                                <h5 className="text-md font-semibold mb-2">Historial de SN Acumulados:</h5>
                                {Array.isArray(selectedCase.SNAcumulados_Historial) && selectedCase.SNAcumulados_Historial.length > 0 ? (
                                    <ul className="space-y-2 text-sm bg-gray-100 p-3 rounded-md max-h-40 overflow-y-auto border">
                                        {selectedCase.SNAcumulados_Historial.map((item, idx) => (
                                            <li key={idx} className="border-b pb-1 last:border-b-0">
                                                <p className="font-semibold">SN: {item.sn} <span className="font-normal text-gray-500">({new Date(item.timestamp).toLocaleString()})</span></p>
                                                <p className="whitespace-pre-wrap pl-2">Obs: {item.obs}</p>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-gray-500">No hay SN acumulados guardados.</p>
                                )}
                            </div>
                        </div>

                        {selectedCase.Estado_Gestion === 'Escalado' && (
                            <div className="mt-4 mb-6 p-4 border border-red-200 rounded-md bg-red-50">
                                <h4 className="text-lg font-semibold text-red-800 mb-3">Detalles de Escalación</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="areaEscalada" className="block text-sm font-medium text-gray-700 mb-1">Área Escalada:</label>
                                        <select id="areaEscalada" name="areaEscalada" value={selectedCase.areaEscalada || ''} onChange={(e) => handleModalFieldChange('areaEscalada', e.target.value)} className="block w-full input-form">
                                            <option value="">Seleccione Área...</option>{AREAS_ESCALAMIENTO.map(area => <option key={area} value={area}>{area}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="motivoEscalado" className="block text-sm font-medium text-gray-700 mb-1">Motivo/Acción Escalado:</label>
                                        <select id="motivoEscalado" name="motivoEscalado" value={selectedCase.motivoEscalado || ''} onChange={(e) => handleModalFieldChange('motivoEscalado', e.target.value)} className="block w-full input-form" disabled={!selectedCase.areaEscalada}>
                                            <option value="">Seleccione Motivo/Acción...</option>{(MOTIVOS_ESCALAMIENTO_POR_AREA[selectedCase.areaEscalada] || []).map(motivo => <option key={motivo} value={motivo}>{motivo}</option>)}
                                        </select>
                                    </div>
                                    <div className="md:col-span-2">
                                        <button onClick={handleSuggestEscalation} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50" disabled={isSuggestingEscalation}>
                                            {isSuggestingEscalation ? 'Sugiriendo...' : 'Sugerir Escalación (IA)'}
                                        </button>
                                    </div>
                                    <div><label htmlFor="idEscalado" className="block text-sm font-medium text-gray-700 mb-1">ID Escalado:</label><input type="text" id="idEscalado" name="idEscalado" value={selectedCase.idEscalado || ''} onChange={(e) => handleModalFieldChange('idEscalado', e.target.value)} className="block w-full input-form" placeholder="ID del escalamiento"/></div>
                                    <div><label htmlFor="reqGenerado" className="block text-sm font-medium text-gray-700 mb-1">REQ Generado:</label><input type="text" id="reqGenerado" name="reqGenerado" value={selectedCase.reqGenerado || ''} onChange={(e) => handleModalFieldChange('reqGenerado', e.target.value)} className="block w-full input-form" placeholder="REQ o ticket generado"/></div>
                                    <div className="md:col-span-2"><label htmlFor="descripcionEscalamiento" className="block text-sm font-medium text-gray-700 mb-1">Descripción Breve del Escalamiento:</label><textarea id="descripcionEscalamiento" name="descripcionEscalamiento" rows="3" value={selectedCase.descripcionEscalamiento || ''} onChange={(e) => handleModalFieldChange('descripcionEscalamiento', e.target.value)} className="block w-full input-form" placeholder="Añada una descripción del escalamiento..."/></div>
                                </div>
                                <div className="mt-4 border-t pt-4">
                                    <button onClick={handleSaveEscalamientoHistory} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">Guardar Escalación</button>
                                </div>
                                <div className="mt-4">
                                    <h5 className="text-md font-semibold mb-2">Historial de Escalaciones:</h5>
                                    {Array.isArray(selectedCase.Escalamiento_Historial) && selectedCase.Escalamiento_Historial.length > 0 ? (
                                        <ul className="space-y-2 text-sm bg-gray-100 p-3 rounded-md max-h-40 overflow-y-auto border">
                                            {selectedCase.Escalamiento_Historial.map((item, idx) => (
                                                <li key={idx} className="border-b pb-1 last:border-b-0">
                                                    <p className="font-semibold text-gray-700">Escalado: {new Date(item.timestamp).toLocaleString()}</p>
                                                    <p><strong>Área:</strong> {item.areaEscalada}, <strong>Motivo:</strong> {item.motivoEscalado}</p>
                                                    <p><strong>ID:</strong> {item.idEscalado || 'N/A'}, <strong>REQ:</strong> {item.reqGenerado || 'N/A'}</p>
                                                    {item.descripcionEscalamiento && <p><strong>Desc:</strong> {item.descripcionEscalamiento}</p>}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-gray-500">No hay historial de escalación.</p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="mt-4 mb-6 p-4 border border-blue-200 rounded-md bg-blue-50">
                            <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowGestionesAdicionales(prev => !prev)}>
                                <h4 className="text-lg font-semibold text-blue-800">Aseguramiento y Gestiones Adicionales</h4>
                                <span className="text-blue-600 font-bold text-xl">{showGestionesAdicionales ? '-' : '+'}</span>
                            </div>
                            {showGestionesAdicionales && (
                            <div className="mt-3">
                                <div className="mb-3">
                                    <label className="inline-flex items-center">
                                        <input type="checkbox" className="form-checkbox h-5 w-5 text-blue-600" name="Requiere_Aseguramiento_Facturas" checked={selectedCase.Requiere_Aseguramiento_Facturas || false} onChange={(e) => handleModalFieldChange('Requiere_Aseguramiento_Facturas', e.target.checked)} />
                                        <span className="ml-2 text-gray-700 font-medium">¿Requiere Aseguramiento Próximas Facturas?</span>
                                    </label>
                                </div>
                                {selectedCase.Requiere_Aseguramiento_Facturas && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-5 mb-4 border-l-2 border-blue-300">
                                        <div><label htmlFor="ID_Aseguramiento" className="block text-sm font-medium text-gray-700 mb-1">ID Aseguramiento:</label><input type="text" id="ID_Aseguramiento" name="ID_Aseguramiento" className="block w-full input-form" value={selectedCase.ID_Aseguramiento || ''} onChange={(e) => handleModalFieldChange('ID_Aseguramiento', e.target.value)} placeholder="ID"/></div>
                                        <div><label htmlFor="Corte_Facturacion_Aseguramiento" className="block text-sm font-medium text-gray-700 mb-1">Corte Facturación:</label><input type="text" id="Corte_Facturacion_Aseguramiento" name="Corte_Facturacion" className="block w-full input-form" value={selectedCase.Corte_Facturacion || ''} onChange={(e) => handleModalFieldChange('Corte_Facturacion', e.target.value)} placeholder="Ej: 15" disabled={!!selectedCase.ID_Aseguramiento}/></div>
                                        <div><label htmlFor="Cuenta_Aseguramiento" className="block text-sm font-medium text-gray-700 mb-1">Cuenta:</label><input type="text" id="Cuenta_Aseguramiento" name="Cuenta" className="block w-full input-form" value={selectedCase.Cuenta || ''} onChange={(e) => handleModalFieldChange('Cuenta', e.target.value)} placeholder="Número cuenta" disabled={!!selectedCase.ID_Aseguramiento}/></div>
                                        <div><label htmlFor="Operacion_Aseguramiento" className="block text-sm font-medium text-gray-700 mb-1">Operación Aseguramiento:</label><select id="Operacion_Aseguramiento" name="Operacion_Aseguramiento" value={selectedCase.Operacion_Aseguramiento || ''} onChange={(e) => handleModalFieldChange('Operacion_Aseguramiento', e.target.value)} className="block w-full input-form" disabled={!!selectedCase.ID_Aseguramiento}><option value="">Seleccione...</option>{TIPOS_OPERACION_ASEGURAMIENTO.map(op => <option key={op} value={op}>{op}</option>)}</select></div>
                                        <div><label htmlFor="Mes_Aseguramiento" className="block text-sm font-medium text-gray-700 mb-1">Mes Aseguramiento:</label><select id="Mes_Aseguramiento" name="Mes_Aseguramiento" value={selectedCase.Mes_Aseguramiento || ''} onChange={(e) => handleModalFieldChange('Mes_Aseguramiento', e.target.value)} className="block w-full input-form" disabled={!!selectedCase.ID_Aseguramiento}><option value="">Seleccione...</option>{MESES_ASEGURAMIENTO.map(mes => <option key={mes} value={mes}>{mes.charAt(0).toUpperCase() + mes.slice(1)}</option>)}</select></div>
                                        <div className="md:col-span-2"><label htmlFor="Tipo_Aseguramiento" className="block text-sm font-medium text-gray-700 mb-1">Tipo Aseguramiento:</label><select id="Tipo_Aseguramiento" name="Tipo_Aseguramiento" value={selectedCase.Tipo_Aseguramiento || ''} onChange={(e) => handleModalFieldChange('Tipo_Aseguramiento', e.target.value)} className="block w-full input-form" disabled={!!selectedCase.ID_Aseguramiento}><option value="">Seleccione...</option>{TIPOS_ASEGURAMIENTO.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}</select></div>
                                    </div>
                                )}
                                
                                <div className="mb-3 mt-4">
                                    <label className="inline-flex items-center">
                                        <input type="checkbox" className="form-checkbox h-5 w-5 text-red-600" name="requiereBaja" checked={selectedCase.requiereBaja || false} onChange={(e) => handleModalFieldChange('requiereBaja', e.target.checked)} />
                                        <span className="ml-2 text-gray-700 font-medium">¿Requiere Baja?</span>
                                    </label>
                                </div>
                                {selectedCase.requiereBaja && (
                                    <div className="pl-5 mb-4 border-l-2 border-red-300">
                                        <label htmlFor="numeroOrdenBaja" className="block text-sm font-medium text-gray-700 mb-1">Número de Orden de Baja:</label>
                                        <input type="text" id="numeroOrdenBaja" name="numeroOrdenBaja" className="block w-full input-form" value={selectedCase.numeroOrdenBaja || ''} onChange={(e) => handleModalFieldChange('numeroOrdenBaja', e.target.value)} placeholder="Número de Orden"/>
                                    </div>
                                )}

                                <div className="mb-3 mt-4">
                                    <label className="inline-flex items-center">
                                        <input type="checkbox" className="form-checkbox h-5 w-5 text-green-600" name="requiereAjuste" checked={selectedCase.requiereAjuste || false} onChange={(e) => handleModalFieldChange('requiereAjuste', e.target.checked)} />
                                        <span className="ml-2 text-gray-700 font-medium">¿Requiere Ajuste?</span>
                                    </label>
                                </div>
                                {selectedCase.requiereAjuste && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-5 mb-4 border-l-2 border-green-300">
                                        <div>
                                            <label htmlFor="numeroTT" className="block text-sm font-medium text-gray-700 mb-1">Número de TT:</label>
                                            <input type="text" id="numeroTT" name="numeroTT" className="block w-full input-form" value={selectedCase.numeroTT || ''} onChange={(e) => handleModalFieldChange('numeroTT', e.target.value)} placeholder="Número TT"/>
                                        </div>
                                        <div>
                                            <label htmlFor="estadoTT" className="block text-sm font-medium text-gray-700 mb-1">Estado TT:</label>
                                            <select id="estadoTT" name="estadoTT" value={selectedCase.estadoTT || ''} onChange={(e) => handleModalFieldChange('estadoTT', e.target.value)} className="block w-full input-form">
                                                <option value="">Seleccione Estado...</option>
                                                {ESTADOS_TT.map(estado => <option key={estado} value={estado}>{estado}</option>)}
                                            </select>
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="inline-flex items-center mt-2">
                                                <input type="checkbox" className="form-checkbox h-5 w-5 text-green-600" name="requiereDevolucionDinero" checked={selectedCase.requiereDevolucionDinero || false} onChange={(e) => handleModalFieldChange('requiereDevolucionDinero', e.target.checked)} disabled={!selectedCase.requiereAjuste}/>
                                                <span className="ml-2 text-gray-700">¿Requiere Devolución Dinero?</span>
                                            </label>
                                        </div>
                                        {selectedCase.requiereDevolucionDinero && (
                                            <div className="contents"> 
                                                <div><label htmlFor="cantidadDevolver" className="block text-sm font-medium text-gray-700 mb-1">Cantidad a Devolver:</label><input type="number" step="0.01" id="cantidadDevolver" name="cantidadDevolver" className="block w-full input-form" value={selectedCase.cantidadDevolver || ''} onChange={(e) => handleModalFieldChange('cantidadDevolver', e.target.value)} placeholder="0.00" disabled={!selectedCase.requiereAjuste || !selectedCase.requiereDevolucionDinero}/></div>
                                                <div><label htmlFor="idEnvioDevoluciones" className="block text-sm font-medium text-gray-700 mb-1">ID Envío Devoluciones:</label><input type="text" id="idEnvioDevoluciones" name="idEnvioDevoluciones" className="block w-full input-form" value={selectedCase.idEnvioDevoluciones || ''} onChange={(e) => handleModalFieldChange('idEnvioDevoluciones', e.target.value)} placeholder="ID" disabled={!selectedCase.requiereAjuste || !selectedCase.requiereDevolucionDinero}/></div>
                                                <div><label htmlFor="fechaEfectivaDevolucion" className="block text-sm font-medium text-gray-700 mb-1">Fecha Efectiva Devolución:</label><input type="date" id="fechaEfectivaDevolucion" name="fechaEfectivaDevolucion" className="block w-full input-form" value={selectedCase.fechaEfectivaDevolucion || ''} onChange={(e) => handleModalFieldChange('fechaEfectivaDevolucion', e.target.value)} disabled={!selectedCase.requiereAjuste || !selectedCase.requiereDevolucionDinero}/></div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                 <div className="mt-4">
                                     <label htmlFor="aseguramientoObs" className="block text-sm font-medium text-gray-700 mb-1">Observaciones de la Gestión:</label>
                                     <textarea id="aseguramientoObs" rows="3" className="block w-full input-form" value={aseguramientoObs} onChange={(e) => setAseguramientoObs(e.target.value)} placeholder="Añadir observaciones sobre la gestión de aseguramiento, baja o ajuste..."/>
                                 </div>
                                 <div className="mt-4 border-t pt-4">
                                     <button onClick={handleSaveAseguramientoHistory} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" disabled={!selectedCase.Requiere_Aseguramiento_Facturas && !selectedCase.requiereBaja && !selectedCase.requiereAjuste}>
                                         Guardar Gestión de Aseguramiento
                                     </button>
                                 </div>
                                 <div className="mt-4">
                                     <h5 className="text-md font-semibold mb-2">Historial de Aseguramientos:</h5>
                                     {Array.isArray(selectedCase.Aseguramiento_Historial) && selectedCase.Aseguramiento_Historial.length > 0 ? (
                                         <ul className="space-y-3 text-sm bg-gray-100 p-3 rounded-md max-h-40 overflow-y-auto border">
                                             {selectedCase.Aseguramiento_Historial.map((item, idx) => (
                                                 <li key={idx} className="border-b pb-2 last:border-b-0">
                                                     <p className="font-semibold text-gray-700">Guardado: {new Date(item.timestamp).toLocaleString()}</p>
                                                     {item.Requiere_Aseguramiento_Facturas && <div><p className="font-medium text-gray-600">Aseguramiento Facturas:</p><p className="pl-2">ID: {item.ID_Aseguramiento}, Corte: {item.Corte_Facturacion}, Cuenta: {item.Cuenta}, Op: {item.Operacion_Aseguramiento}, Tipo: {item.Tipo_Aseguramiento}, Mes: {item.Mes_Aseguramiento}</p></div>}
                                                     {item.requiereBaja && <div><p className="font-medium text-gray-600">Baja:</p><p className="pl-2">Orden: {item.numeroOrdenBaja}</p></div>}
                                                     {item.requiereAjuste && <div><p className="font-medium text-gray-600">Ajuste:</p><p className="pl-2">TT: {item.numeroTT}, Estado: {item.estadoTT}</p></div>}
                                                     {item.observaciones && <p className="mt-1"><strong>Obs:</strong> {item.observaciones}</p>}
                                                 </li>
                                             ))}
                                         </ul>
                                     ) : (
                                         <p className="text-sm text-gray-500">No hay historial de aseguramiento.</p>
                                     )}
                                 </div>
                            </div>
                            )}
                        </div>

                        <div className="mt-6 border-t pt-6">
                            <h4 className="text-xl font-semibold mb-4">Análisis y Observaciones</h4>
                            <div className="mb-4">
                                <label htmlFor="observations-input" className="block text-sm font-medium mb-1">Observaciones (Gestión):</label>
                                <div className="flex gap-2 mb-2">
                                    <textarea 
                                        id="observations-input" 
                                        rows="4" 
                                        className="block w-full rounded-md p-2 border" 
                                        value={selectedCase.Observaciones || ''}
                                        onChange={handleObservationsChange} 
                                        placeholder="Añade observaciones..."
                                    />
                                    <button onClick={saveObservation} className="self-start px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Guardar Obs.</button>
                                </div>
                                <h5 className="text-md font-semibold mb-2">Historial Observaciones:</h5>
                                {Array.isArray(selectedCase.Observaciones_Historial) && selectedCase.Observaciones_Historial.length > 0 ? (
                                    <ul className="space-y-2 text-sm bg-gray-100 p-3 rounded-md max-h-40 overflow-y-auto border">
                                        {selectedCase.Observaciones_Historial.map((en, idx) => (
                                            <li key={idx} className="border-b pb-1 last:border-b-0">
                                                <p className="font-medium">{new Date(en.timestamp).toLocaleString()}</p>
                                                <p className="whitespace-pre-wrap">{en.text}</p>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-gray-500">No hay historial.</p>
                                )}
                            </div>
                        </div>

                        <div className="mt-6 border-t pt-6">
                            <h4 className="text-xl font-semibold mb-2">Proyección de Respuesta IA</h4>
                            <div className="relative">
                                <textarea 
                                    id="proyeccionRespuestaIA" 
                                    rows="8" 
                                    className="block w-full rounded-md p-2 pr-10 bg-gray-50 border" 
                                    value={selectedCase.Proyeccion_Respuesta_IA || 'No generada'} 
                                    readOnly 
                                    placeholder="Proyección IA aparecerá aquí..."
                                />
                                <button 
                                    onClick={() => copyToClipboard(selectedCase.Proyeccion_Respuesta_IA || '', 'Proyección Respuesta IA', displayModalMessage)} 
                                    className="absolute top-1 right-1 p-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded" 
                                    title="Copiar Proyección Respuesta IA"
                                >
                                    Copiar
                                </button>
                            </div>
                            <button 
                                onClick={generateAIResponseProjectionHandler} 
                                className="mt-3 px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700" 
                                disabled={isGeneratingResponseProjection}
                            >
                                {isGeneratingResponseProjection ? 'Generando...' : 'Generar Proyección IA'}
                            </button>
                        </div>
                        
                        <div className="mt-6 border-t pt-6">
                            <h4 className="text-xl font-semibold mb-4">Gestión del Caso</h4>
                            <div className="flex flex-wrap gap-3 mb-6">
                                {[
                                    {l:'Iniciado',s:'Iniciado',cl:'indigo'},
                                    {l:'Lectura',s:'Lectura',cl:'blue'},
                                    {l:'Decretado',s:'Decretado',cl:'purple'},
                                    {l:'Traslado SIC',s:'Traslado SIC',cl:'orange'},
                                    {l:'Pendiente Ajustes',s:'Pendiente Ajustes',cl:'pink'}, 
                                    {l:'Resuelto',s:'Resuelto',cl:'green'},
                                    {l:'Pendiente',s:'Pendiente',cl:'yellow'},
                                    {l:'Escalado',s:'Escalado',cl:'red'}
                                ].map(b=>(<button key={b.s} onClick={()=>handleChangeCaseStatus(b.s)} className={`px-4 py-2 rounded-md font-semibold ${selectedCase.Estado_Gestion===b.s?`bg-${b.cl}-600 text-white`:`bg-${b.cl}-200 text-${b.cl}-800 hover:bg-${b.cl}-300`} `}>{b.l}</button>))}
                            </div>
                            <div className="mb-4"><label className="inline-flex items-center"><input type="checkbox" className="form-checkbox h-5 w-5" checked={selectedCase.Despacho_Respuesta_Checked||false} onChange={handleDespachoRespuestaChange}/><span className="ml-2 font-semibold">Despacho Respuesta</span></label></div>
                        </div>

                        <div className="flex justify-end mt-6 gap-4">
                            {selectedCase.Estado_Gestion === 'Resuelto' && (
                                <button onClick={() => handleReopenCase(selectedCase)} className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 mr-auto">
                                    Reabrir Caso
                                </button>
                            )}
                            <button onClick={() => handleDeleteCase(selectedCase.id)} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700">
                                Eliminar
                            </button>
                            <button onClick={handleCloseCaseDetails} className="px-6 py-3 bg-red-600 text-white rounded-md hover:bg-red-700">
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showManualEntryModal && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-auto overflow-y-auto max-h-[90vh]"> 
                        <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">Ingresar Caso Manualmente</h3>
                        <form onSubmit={handleManualSubmit}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                {['SN','CUN','FechaRadicado','FechaVencimiento','Nro_Nuip_Cliente','Nombre_Cliente','Dia'].map(f=>(<div key={f}><label htmlFor={`manual${f}`} className="block text-sm font-medium mb-1">{f.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase())}:</label><input type={f.includes('Fecha')?'date':'text'} id={`manual${f}`} name={f} value={manualFormData[f]} onChange={handleManualFormChange} required={['SN','CUN','FechaRadicado'].includes(f)} className="block w-full input-form"/></div>))}
                                <div className="md:col-span-2"><label htmlFor="manualOBS" className="block text-sm font-medium mb-1">OBS:</label><textarea id="manualOBS" name="OBS" rows="3" value={manualFormData.OBS} onChange={handleManualFormChange} className="block w-full input-form"/></div>
                                <div className="md:col-span-2"><label htmlFor="manualTipo_Contrato" className="block text-sm font-medium text-gray-700 mb-1">Tipo de Contrato:</label><select id="manualTipo_Contrato" name="Tipo_Contrato" value={manualFormData.Tipo_Contrato} onChange={handleManualFormChange} className="block w-full input-form"><option value="Condiciones Uniformes">Condiciones Uniformes</option><option value="Contrato Marco">Contrato Marco</option></select></div>
                                <div className="md:col-span-2">
                                    <label htmlFor="manualEstado_Gestion" className="block text-sm font-medium text-gray-700 mb-1">Estado Gestión Inicial:</label>
                                    <select id="manualEstado_Gestion" name="Estado_Gestion" value={manualFormData.Estado_Gestion || 'Pendiente'} onChange={handleManualFormChange} className="block w-full input-form">
                                        <option value="Pendiente">Pendiente</option>
                                        <option value="Iniciado">Iniciado</option>
                                        <option value="Lectura">Lectura</option>
                                        <option value="Escalado">Escalado</option>
                                        <option value="Pendiente Ajustes">Pendiente Ajustes</option>
                                    </select>
                                </div>
                            </div>

                            {manualFormData.Estado_Gestion === 'Escalado' && (
                                <div className="mt-4 mb-6 p-3 border border-red-200 rounded-md bg-red-50">
                                    <h4 className="text-md font-semibold text-red-700 mb-2">Detalles de Escalación (Manual)</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div><label htmlFor="manualAreaEscalada" className="block text-xs mb-1">Área Escalada:</label><select id="manualAreaEscalada" name="areaEscalada" value={manualFormData.areaEscalada} onChange={handleManualFormChange} className="block w-full input-form text-sm"><option value="">Seleccione Área...</option>{AREAS_ESCALAMIENTO.map(area => <option key={area} value={area}>{area}</option>)}</select></div>
                                        <div><label htmlFor="manualMotivoEscalado" className="block text-xs mb-1">Motivo/Acción:</label><select id="manualMotivoEscalado" name="motivoEscalado" value={manualFormData.motivoEscalado} onChange={handleManualFormChange} className="block w-full input-form text-sm" disabled={!manualFormData.areaEscalada}><option value="">Seleccione Motivo...</option>{(MOTIVOS_ESCALAMIENTO_POR_AREA[manualFormData.areaEscalada] || []).map(motivo => <option key={motivo} value={motivo}>{motivo}</option>)}</select></div>
                                        <div><label htmlFor="manualIdEscalado" className="block text-xs mb-1">ID Escalado:</label><input type="text" id="manualIdEscalado" name="idEscalado" value={manualFormData.idEscalado} onChange={handleManualFormChange} className="block w-full input-form text-sm" placeholder="ID"/></div>
                                        <div><label htmlFor="manualReqGenerado" className="block text-xs mb-1">REQ Generado:</label><input type="text" id="manualReqGenerado" name="reqGenerado" value={manualFormData.reqGenerado} onChange={handleManualFormChange} className="block w-full input-form text-sm" placeholder="REQ"/></div>
                                    </div>
                                </div>
                            )}
                            
                            <div className="mt-4 mb-6 p-3 border border-blue-200 rounded-md bg-blue-50">
                                <h4 className="text-md font-semibold text-blue-700 mb-2">Aseguramiento y Gestiones Adicionales (Manual)</h4>
                                <div className="mb-2"><label className="inline-flex items-center"><input type="checkbox" name="Requiere_Aseguramiento_Facturas" checked={manualFormData.Requiere_Aseguramiento_Facturas} onChange={handleManualFormChange} className="form-checkbox"/><span className="ml-2 text-sm">¿Aseguramiento Facturas?</span></label></div>
                                {manualFormData.Requiere_Aseguramiento_Facturas && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-4 mb-3 border-l-2 border-blue-300">
                                        <div><label htmlFor="manualID_Aseguramiento" className="block text-xs mb-1">ID Aseguramiento:</label><input type="text" id="manualID_Aseguramiento" name="ID_Aseguramiento" value={manualFormData.ID_Aseguramiento} onChange={handleManualFormChange} className="block w-full input-form text-sm"/></div>
                                        <div><label htmlFor="manualCorte_Facturacion" className="block text-xs mb-1">Corte Facturación:</label><input type="text" id="manualCorte_Facturacion" name="Corte_Facturacion" value={manualFormData.Corte_Facturacion} onChange={handleManualFormChange} className="block w-full input-form text-sm" disabled={!!manualFormData.ID_Aseguramiento}/></div>
                                        <div><label htmlFor="manualCuenta" className="block text-xs mb-1">Cuenta:</label><input type="text" id="manualCuenta" name="Cuenta" value={manualFormData.Cuenta} onChange={handleManualFormChange} className="block w-full input-form text-sm" disabled={!!manualFormData.ID_Aseguramiento}/></div>
                                        <div><label htmlFor="manualOperacion_Aseguramiento" className="block text-xs mb-1">Operación:</label><select name="Operacion_Aseguramiento" value={manualFormData.Operacion_Aseguramiento} onChange={handleManualFormChange} className="block w-full input-form text-sm" disabled={!!manualFormData.ID_Aseguramiento}><option value="">Seleccione...</option>{TIPOS_OPERACION_ASEGURAMIENTO.map(op=><option key={op} value={op}>{op}</option>)}</select></div>
                                        <div className="md:col-span-2"><label htmlFor="manualTipo_Aseguramiento" className="block text-xs mb-1">Tipo:</label><select name="Tipo_Aseguramiento" value={manualFormData.Tipo_Aseguramiento} onChange={handleManualFormChange} className="block w-full input-form text-sm" disabled={!!manualFormData.ID_Aseguramiento}><option value="">Seleccione...</option>{TIPOS_ASEGURAMIENTO.map(tipo=><option key={tipo} value={tipo}>{tipo}</option>)}</select></div>
                                        <div><label htmlFor="manualMes_Aseguramiento" className="block text-xs mb-1">Mes:</label><select name="Mes_Aseguramiento" value={manualFormData.Mes_Aseguramiento} onChange={handleManualFormChange} className="block w-full input-form text-sm" disabled={!!manualFormData.ID_Aseguramiento}><option value="">Seleccione...</option>{MESES_ASEGURAMIENTO.map(mes=><option key={mes} value={mes}>{mes.charAt(0).toUpperCase()+mes.slice(1)}</option>)}</select></div>
                                    </div>
                                )}
                                
                                <div className="mb-2 mt-3"><label className="inline-flex items-center"><input type="checkbox" name="requiereBaja" checked={manualFormData.requiereBaja} onChange={handleManualFormChange} className="form-checkbox"/><span className="ml-2 text-sm">¿Requiere Baja?</span></label></div>
                                {manualFormData.requiereBaja && (
                                    <div className="pl-4 mb-3 border-l-2 border-red-300">
                                        <label htmlFor="manualNumeroOrdenBaja" className="block text-xs mb-1">Nro. Orden Baja:</label><input type="text" id="manualNumeroOrdenBaja" name="numeroOrdenBaja" value={manualFormData.numeroOrdenBaja} onChange={handleManualFormChange} className="block w-full input-form text-sm"/>
                                    </div>
                                )}

                                <div className="mb-2 mt-3"><label className="inline-flex items-center"><input type="checkbox" name="requiereAjuste" checked={manualFormData.requiereAjuste} onChange={handleManualFormChange} className="form-checkbox"/><span className="ml-2 text-sm">¿Requiere Ajuste?</span></label></div>
                                {manualFormData.requiereAjuste && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-4 mb-3 border-l-2 border-green-300">
                                        <div><label htmlFor="manualNumeroTT" className="block text-xs mb-1">Nro. TT:</label><input type="text" id="manualNumeroTT" name="numeroTT" value={manualFormData.numeroTT} onChange={handleManualFormChange} className="block w-full input-form text-sm"/></div>
                                        <div><label htmlFor="manualEstadoTT" className="block text-xs mb-1">Estado TT:</label><select id="manualEstadoTT" name="estadoTT" value={manualFormData.estadoTT} onChange={handleManualFormChange} className="block w-full input-form text-sm"><option value="">Seleccione...</option>{ESTADOS_TT.map(estado=><option key={estado} value={estado}>{estado}</option>)}</select></div>
                                        <div className="md:col-span-2"><label className="inline-flex items-center mt-1"><input type="checkbox" name="requiereDevolucionDinero" checked={manualFormData.requiereDevolucionDinero} onChange={handleManualFormChange} className="form-checkbox" disabled={!manualFormData.requiereAjuste}/><span className="ml-2 text-xs">¿Devolución Dinero?</span></label></div>
                                        {manualFormData.requiereDevolucionDinero && (
                                            <div className="contents">
                                                <div><label htmlFor="manualCantidadDevolver" className="block text-xs mb-1">Cantidad a Devolver:</label><input type="number" step="0.01" id="manualCantidadDevolver" name="cantidadDevolver" value={manualFormData.cantidadDevolver} onChange={handleManualFormChange} className="block w-full input-form text-sm" placeholder="0.00" disabled={!manualFormData.requiereAjuste || !manualFormData.requiereDevolucionDinero}/></div>
                                                <div><label htmlFor="manualIdEnvioDevoluciones" className="block text-xs mb-1">ID Envío Devoluciones:</label><input type="text" id="manualIdEnvioDevoluciones" name="idEnvioDevoluciones" value={manualFormData.idEnvioDevoluciones} onChange={(e) => handleManualFormChange(e)} placeholder="ID" disabled={!manualFormData.requiereAjuste || !manualFormData.requiereDevolucionDinero}/></div>
                                                <div><label htmlFor="manualFechaEfectivaDevolucion" className="block text-sm font-medium text-gray-700 mb-1">Fecha Efectiva Devolución:</label><input type="date" id="manualFechaEfectivaDevolucion" name="fechaEfectivaDevolucion" value={manualFormData.fechaEfectivaDevolucion || ''} onChange={(e) => handleManualFormChange(e)} className="block w-full input-form" disabled={!manualFormData.requiereAjuste || !manualFormData.requiereDevolucionDinero}/></div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end gap-3"><button type="button" onClick={()=>setShowManualEntryModal(false)} className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400">Cancelar</button><button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" disabled={uploading}>{uploading?'Agregando...':'Agregar Caso'}</button></div>
                        </form>
                    </div>
                </div>
            )}
            <style>{`
                .input-form {
                    display: block;
                    width: 100%;
                    border-radius: 0.375rem; /* rounded-md */
                    border-width: 1px;
                    border-color: #D1D5DB; /* border-gray-300 */
                    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); /* shadow-sm */
                    padding: 0.5rem; /* p-2 */
                }
                .input-form:focus {
                    border-color: #3B82F6; /* focus:border-blue-500 */
                    --tw-ring-color: #3B82F6; /* focus:ring-blue-500 */
                    box-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color);
                }
                .input-form:disabled {
                    background-color: #F3F4F6; /* bg-gray-100 or similar for disabled state */
                    cursor: not-allowed;
                }
                .sm\:text-sm { 
                    font-size: 0.875rem; 
                    line-height: 1.25rem; 
                }
                .contents { display: contents; } 

            `}</style>
        </div>
    );
}

export default App;    

