import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';
import { PedidoService } from '../../services/pedido.service';
import { ChatMessage, ChatResponse, ProductRecommendation } from '../../models/chat.model';
import { ModalAgregarProductoComponent } from '../modal-agregar-producto/modal-agregar-producto.component';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalAgregarProductoComponent],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer', { static: false }) messagesContainer!: ElementRef;

  messages: ChatMessage[] = [];
  newMessage: string = '';
  isLoading: boolean = false;
  sessionId: string = '';
  isConnected: boolean = false;
  recommendations: ProductRecommendation[] = [];
  showRecommendations: boolean = false;
  
  // Para el modal de agregar producto
  mostrarModalAgregar: boolean = false;
  productoParaAgregar: any = null;

  // Para notificaciones de alergias
  alergiasDetectadas: string[] = [];
  mostrarNotificacionAlergias: boolean = false;

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private chatService: ChatService,
    private pedidoService: PedidoService
  ) {}

  ngOnInit(): void {
    this.sessionId = this.generateSessionId();
    this.initializeChat();
    this.connectWebSocket();
  }

  ngOnDestroy(): void {
    this.chatService.disconnect();
  }

  private generateSessionId(): string {
    return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeChat(): void {
    // Mensaje de bienvenida
    this.messages.push({
      id: 1,
      content: '¡Hola! Soy tu asistente de recomendaciones de UniFood. ¿En qué puedo ayudarte hoy?',
      isUser: false,
      timestamp: new Date(),
      sessionId: this.sessionId
    });
  }

  private connectWebSocket(): void {
    this.chatService.connect(this.sessionId);
    
    this.chatService.onMessage().subscribe((response: ChatResponse) => {
      this.handleBotResponse(response);
    });

    this.chatService.onRecommendations().subscribe((recommendations: ProductRecommendation[]) => {
      this.recommendations = recommendations;
      // NO mostrar recomendaciones automáticamente
      // El usuario decide si quiere verlas
    });

    this.chatService.onConnectionStatus().subscribe((status: boolean) => {
      this.isConnected = status;
    });

    this.chatService.onError().subscribe((error: any) => {
      console.error('Chat error:', error);
      this.addBotMessage('Lo siento, hubo un error. Por favor, intenta de nuevo.');
    });

    // Escuchar detección de alergias
    this.chatService.onAlergiasDetectadas().subscribe((data: any) => {
      this.alergiasDetectadas = data.alergias || [];
      this.mostrarNotificacionAlergias = true;
      
      // Mostrar notificación
      Swal.fire({
        icon: 'info',
        title: 'Alergias detectadas',
        html: `
          <p>He detectado que tienes alergias a:</p>
          <ul style="text-align: left; margin: 10px 0;">
            ${this.alergiasDetectadas.map(a => `<li><strong>${a}</strong></li>`).join('')}
          </ul>
          <p style="margin-top: 15px; font-size: 14px;">
            Las he guardado en tu perfil para futuros pedidos. 
            Te avisaré si algún producto contiene estos ingredientes.
          </p>
        `,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#5B9A97',
        timer: 5000,
        timerProgressBar: true
      });

      // Agregar mensaje al chat
      this.addBotMessage(
        `He detectado que tienes alergias a: ${this.alergiasDetectadas.join(', ')}. ` +
        `Las he guardado en tu perfil. Te avisaré si algún producto contiene estos ingredientes.`
      );
    });
  }

  sendMessage(): void {
    if (!this.newMessage.trim() || this.isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      content: this.newMessage.trim(),
      isUser: true,
      timestamp: new Date(),
      sessionId: this.sessionId
    };

    this.messages.push(userMessage);
    this.isLoading = true;
    this.scrollToBottom();

    // Enviar mensaje a través de WebSocket
    this.chatService.sendMessage({
      mensaje: this.newMessage.trim(),
      sessionId: this.sessionId
    });

    this.newMessage = '';
  }

  private handleBotResponse(response: ChatResponse): void {
    this.isLoading = false;
    
    // Verificar si hay recomendaciones
    const hasRecommendations = response.recomendaciones && response.recomendaciones.length > 0;
    
    const botMessage: ChatMessage = {
      id: Date.now(),
      content: response.respuesta,
      isUser: false,
      timestamp: new Date(response.timestamp),
      sessionId: response.sessionId,
      recommendations: response.recomendaciones || [],
      showRecommendations: false // El usuario decide si las expande
    };

    this.messages.push(botMessage);
    
    // Si hay recomendaciones, guardarlas pero NO mostrar modal automáticamente
    if (hasRecommendations) {
      this.recommendations = response.recomendaciones || [];
    }
    
    this.scrollToBottom();
  }

  private addBotMessage(content: string): void {
    const botMessage: ChatMessage = {
      id: Date.now(),
      content,
      isUser: false,
      timestamp: new Date(),
      sessionId: this.sessionId
    };

    this.messages.push(botMessage);
    this.scrollToBottom();
  }

  shouldShowRecommendations(): boolean {
    if (this.messages.length === 0) return false;
    
    const lastUserMessage = this.messages
      .filter(msg => msg.isUser)
      .pop();
    
    if (!lastUserMessage) return false;
    
    const message = lastUserMessage.content.toLowerCase();
    const recommendationKeywords = [
      'recomiéndame', 'recomendar', 'recomendación', 'recomendaciones',
      'qué me recomiendas', 'que me recomiendas', 'recomendación',
      'sugiéreme', 'sugerir', 'sugerencia', 'sugerencias',
      'qué puedo comer', 'que puedo comer', 'qué puedo pedir', 'que puedo pedir',
      'opciones', 'alternativas', 'menú', 'menu',
      'qué hay disponible', 'que hay disponible', 'disponible',
      'quiero', 'necesito', 'busco', 'me gustaría',
      'algo dulce', 'algo salado', 'algo económico', 'algo barato',
      'algo rico', 'algo rico', 'algo saludable', 'algo rápido'
    ];
    
    return recommendationKeywords.some(keyword => message.includes(keyword));
  }

  private addRecommendationsToChat(recommendations: ProductRecommendation[]): void {
    if (recommendations && recommendations.length > 0) {
      const recommendationsMessage: ChatMessage = {
        id: Date.now() + 1,
        content: 'Aquí tienes algunas recomendaciones para ti:',
        isUser: false,
        timestamp: new Date(),
        sessionId: this.sessionId,
        recommendations: recommendations,
        isRecommendation: true
      };

      this.messages.push(recommendationsMessage);
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop = 
          this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 100);
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  selectRecommendation(recommendation: ProductRecommendation): void {
    // Construir mensaje más específico con contexto del producto
    let message = `Cuéntame más sobre el ${recommendation.nombre}`;
    
    // Agregar información que ya tenemos para dar contexto
    if (recommendation.precio) {
      message += ` que cuesta $${recommendation.precio}`;
    }
    
    if (recommendation.categoria) {
      message += ` de la categoría ${recommendation.categoria}`;
    }
    
    message += '. Quiero saber sus ingredientes, preparación y por qué me lo recomiendas específicamente.';
    
    this.newMessage = message;
    this.sendMessage();
  }

  clearChat(): void {
    this.messages = [];
    this.recommendations = [];
    this.showRecommendations = false;
    this.sessionId = this.generateSessionId();
    this.initializeChat();
    this.chatService.disconnect();
    this.connectWebSocket();
  }

  closeRecommendations(): void {
    this.showRecommendations = false;
  }

  toggleRecommendations(): void {
    this.showRecommendations = !this.showRecommendations;
  }

  toggleMessageRecommendations(message: ChatMessage): void {
    message.showRecommendations = !message.showRecommendations;
  }

  loadChatHistory(): void {
    this.chatService.getChatHistory().subscribe({
      next: (history) => {
        // Convertir historial a mensajes del chat
        const chatMessages: ChatMessage[] = [];
        history.forEach(msg => {
          // Mensaje del usuario
          chatMessages.push({
            id: msg.id,
            content: msg.mensaje_usuario,
            isUser: true,
            timestamp: new Date(msg.timestamp),
            sessionId: msg.session_id || this.sessionId
          });
          // Respuesta del bot
          chatMessages.push({
            id: msg.id + 0.5,
            content: msg.respuesta_gemini.respuesta,
            isUser: false,
            timestamp: new Date(msg.timestamp),
            sessionId: msg.session_id || this.sessionId
          });
        });
        this.messages = chatMessages;
        this.scrollToBottom();
      },
      error: (error) => {
        console.error('Error loading chat history:', error);
      }
    });
  }

  // ========== MÉTODOS PARA AGREGAR AL CARRITO ==========

  abrirModalAgregar(recommendation: ProductRecommendation): void {
    // Convertir la recomendación a formato de producto
    this.productoParaAgregar = {
      id: recommendation.producto_id,
      nombre: recommendation.nombre,
      descripcion: recommendation.descripcion,
      precio: recommendation.precio,
      categoria: recommendation.categoria,
      imagen_url: recommendation.imagen_url,
      disponible: true
    };
    this.mostrarModalAgregar = true;
  }

  cerrarModalAgregar(): void {
    this.mostrarModalAgregar = false;
    this.productoParaAgregar = null;
  }

  agregarProductoAlCarrito(event: { producto: any; cantidad: number; detalles?: string }): void {
    const { producto, cantidad, detalles } = event;
    
    this.pedidoService.agregarAlCarrito(producto, cantidad, detalles);
    
    Swal.fire({
      icon: 'success',
      title: '¡Agregado al carrito!',
      text: `${cantidad} x ${producto.nombre}`,
      timer: 2000,
      showConfirmButton: false,
      toast: true,
      position: 'top-end'
    });
  }
}
