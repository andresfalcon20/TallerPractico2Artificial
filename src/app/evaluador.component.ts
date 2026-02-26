import { Component } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { FormsModule } from '@angular/forms'; 
import { GoogleGenerativeAI } from '@google/generative-ai'; 

interface Ejercicio {
  enunciado: string;
  problema: string;
  prefijo: string;
  respuestaCorrecta: number;
  respuestaUsuario?: number;
  evaluado?: boolean;
  correcto?: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class App {
  // ==========================================
  // VARIABLES DEL EVALUADOR
  // ==========================================
  archivosCargados: File[] = [];
  procesandoDocumento: boolean = false; // Nueva variable para mostrar un "Cargando..."
  
  nuevoEnunciado: string = 'Resuelve el siguiente ejercicio:';
  nuevoProblema: string = '';
  nuevaRespuestaCorrecta: number | null = null;

  ejercicios: Ejercicio[] = [];

  pruebaEvaluada: boolean = false;
  notaFinal: number = 0;
  totalCorrectas: number = 0;

  // ==========================================
  // VARIABLES DEL ASISTENTE VIRTUAL GEMINI
  // ==========================================
  private apiKey = 'AIzaSyBxssES5JS_7Tx45PJ9mJ43k5dU9jIy-ok'; // ¡Pon tu clave aquí!
  private genAI = new GoogleGenerativeAI(this.apiKey);

  visionActivada: boolean = false;
  vozActivada: boolean = false;
  
  mensajeUsuario: string = '';
  historialChat: {role: string, text: string}[] = [];
  
  estaRazonando: boolean = false;
  respuestaActualStream: string = '';
  
  imagenSeleccionada: any = null;

  // ==========================================
  // MÉTODOS DEL EVALUADOR (AHORA CON IA PARA PDF/IMÁGENES)
  // ==========================================
  
  async onFilesSelected(event: any) {
    const files: FileList = event.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.archivosCargados.push(file);

        // Si es un JSON tradicional, lo leemos normal
        if (file.type === 'application/json') {
          this.leerArchivoJSON(file);
        } 
        // Si es PDF o Imagen, usamos a Gemini para extraer los datos
        else if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
          await this.extraerEjerciciosConIA(file);
        } else {
          alert('Formato no soportado. Sube un JSON, PDF o Imagen.');
        }
      }
    }
    event.target.value = ''; // Limpiar input
  }

  leerArchivoJSON(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const contenido = JSON.parse(e.target.result);
        if (Array.isArray(contenido)) {
          this.ejercicios = [...this.ejercicios, ...contenido];
        }
      } catch (error) {
        alert(`El archivo ${file.name} no es un JSON válido.`);
      }
    };
    reader.readAsText(file);
  }

  // ¡NUEVA FUNCIÓN! Gemini lee el PDF/Imagen y autocompleta los ejercicios
  async extraerEjerciciosConIA(file: File) {
    this.procesandoDocumento = true;
    
    try {
      // 1. Convertir el archivo a Base64
      const base64Data = await this.fileToBase64(file);
      const documentPart = {
        inlineData: {
          data: base64Data,
          mimeType: file.type
        }
      };

      // 2. Preparar la instrucción estricta para Gemini
      const prompt = `
        Actúa como un extractor de datos matemáticos. Lee el documento adjunto (que es un examen o lista de ejercicios matemáticos).
        Extrae cada ejercicio matemático que encuentres, resuélvelo para obtener la respuesta correcta, y devuélveme el resultado ÚNICAMENTE como un arreglo JSON válido.
        
        La estructura estricta para cada objeto en el JSON debe ser:
        {
          "enunciado": "La instrucción del ejercicio (ej: Resuelve la ecuación)",
          "problema": "La operación matemática (ej: 5 + 5 * 2)",
          "prefijo": "R =",
          "respuestaCorrecta": El número con el resultado correcto
        }

        NO incluyas texto adicional, ni saludos, ni formato markdown (\`\`\`json). SOLO devuelve el texto del arreglo JSON puro para que pueda parsearlo directamente.
      `;

      // 3. Llamar a Gemini
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([prompt, documentPart]);
      const responseText = result.response.text().trim();

      // 4. Limpiar posibles formatos markdown que la IA a veces incluye por error
      let jsonLimpio = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

      // 5. Autocompletar el sistema
      const ejerciciosExtraidos = JSON.parse(jsonLimpio);
      if (Array.isArray(ejerciciosExtraidos)) {
        this.ejercicios = [...this.ejercicios, ...ejerciciosExtraidos];
      }

    } catch (error) {
      console.error("Error al procesar el documento con IA:", error);
      alert("Hubo un error al intentar leer el PDF con la Inteligencia Artificial. Asegúrate de que los ejercicios sean legibles.");
    } finally {
      this.procesandoDocumento = false;
    }
  }

  // Función auxiliar para convertir archivos a Base64
  fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]); // Obtenemos solo la parte base64
      };
      reader.onerror = error => reject(error);
    });
  }

  agregarEjercicioManual() {
    if (this.nuevoProblema && this.nuevaRespuestaCorrecta !== null) {
      this.ejercicios.push({
        enunciado: this.nuevoEnunciado,
        problema: this.nuevoProblema,
        prefijo: "R =",
        respuestaCorrecta: this.nuevaRespuestaCorrecta
      });
      this.nuevoProblema = '';
      this.nuevaRespuestaCorrecta = null;
    }
  }

  evaluarPrueba() {
    if (this.ejercicios.length === 0) return;
    this.totalCorrectas = 0;
    this.pruebaEvaluada = true;

    this.ejercicios.forEach(ej => {
      ej.evaluado = true;
      if (ej.respuestaUsuario !== undefined && ej.respuestaUsuario !== null) {
        ej.correcto = (ej.respuestaUsuario === ej.respuestaCorrecta);
        if (ej.correcto) this.totalCorrectas++;
      } else {
        ej.correcto = false; 
      }
    });

    let calificacion = (this.totalCorrectas / this.ejercicios.length) * 10;
    this.notaFinal = Math.round(calificacion * 100) / 100;
  }

  reiniciarPrueba() {
    this.ejercicios = [];
    this.archivosCargados = [];
    this.pruebaEvaluada = false;
    this.notaFinal = 0;
    this.totalCorrectas = 0;
  }

  // ==========================================
  // MÉTODOS DEL ASISTENTE VIRTUAL (CHAT / VISIÓN / VOZ)
  // ==========================================
  
  async onImageSelectedAI(event: any) {
    const file = event.target.files[0];
    if (file) {
      const base64Data = await this.fileToBase64(file);
      this.imagenSeleccionada = {
        inlineData: {
          data: base64Data,
          mimeType: file.type
        }
      };
    }
  }

  async enviarMensajeAI() {
    if (!this.mensajeUsuario && !this.imagenSeleccionada) return;

    const textoUsuario = this.mensajeUsuario;
    this.historialChat.push({ role: 'user', text: textoUsuario });
    
    this.mensajeUsuario = '';
    this.estaRazonando = true;
    this.respuestaActualStream = '';

    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      let contenidoAEnviar: any[] = [];
      
      if (this.visionActivada && this.imagenSeleccionada) {
         contenidoAEnviar = [
           "Actúa como un modelo de clasificación de imágenes. Dime la etiqueta principal de esta imagen de forma breve.", 
           this.imagenSeleccionada
         ];
      } else {
         contenidoAEnviar = [textoUsuario];
      }

      const result = await model.generateContentStream(contenidoAEnviar);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        this.respuestaActualStream += chunkText; 
      }

      this.historialChat.push({ role: 'model', text: this.respuestaActualStream });
      
      if (this.vozActivada) {
        this.hablarTexto(this.respuestaActualStream);
      }

    } catch (error) {
      console.error("Error con Gemini:", error);
      this.historialChat.push({ role: 'model', text: 'Error de conexión con la IA.' });
    } finally {
      this.estaRazonando = false;
      this.respuestaActualStream = '';
      this.imagenSeleccionada = null; 
    }
  }

  hablarTexto(texto: string) {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(texto);
      utterance.lang = 'es-ES';
      window.speechSynthesis.speak(utterance);
    } else {
      alert("Tu navegador no soporta lectura por voz.");
    }
  }
}
