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

// Todas tus funciones de ayuda (getColombianDateISO, parseCSV, etc.) van aquí
const getColombianDateISO = () => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
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

// ... y el resto de tus funciones de IA y de ayuda ...
// ...
// ...

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

  // ... (El resto de tu código gigante va aquí)

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-lg">Cargando...</div></div>;

  return (
      <div className="min-h-screen bg-gray-100 p-4 font-sans flex flex-col items-center">
         {/* Tu JSX completo va aquí... */}
         <h1>Seguimiento de Casos Asignados</h1>
         {/* ...y el resto de tu interfaz */}
      </div>
  );
}

export default App;
