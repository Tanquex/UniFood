import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { ChatMessage, ChatResponse, ProductRecommendation, ChatHistory } from '../models/chat.model';
import { io, Socket } from 'socket.io-client';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private socket: Socket | null = null;
  private baseUrl = 'http://localhost:3000'; // URL del backend
  private wsUrl = 'http://localhost:3000'; // URL del WebSocket

  // Subjects para manejar eventos
  private messageSubject = new Subject<ChatResponse>();
  private recommendationsSubject = new Subject<ProductRecommendation[]>();
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new Subject<any>();
  private alergiasDetectadasSubject = new Subject<any>();

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  connect(sessionId: string): void {
    try {
      // Obtener userId del usuario autenticado
      const user = this.authService.obtenerUsuario();
      const userId = user?.id || 1; // Fallback a 1 si no hay usuario

      this.socket = io(`${this.wsUrl}/chat`, {
        auth: {
          userId: userId
        },
        transports: ['websocket']
      });

      this.socket.on('connect', () => {
        console.log('Connected to chat WebSocket');
        this.connectionStatusSubject.next(true);
        
        // Unir a la sesión
        this.socket?.emit('join_session', { sessionId });
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from chat WebSocket');
        this.connectionStatusSubject.next(false);
      });

      this.socket.on('message_response', (response: ChatResponse) => {
        this.messageSubject.next(response);
      });

      this.socket.on('recommendations', (data: { recomendaciones: ProductRecommendation[] }) => {
        this.recommendationsSubject.next(data.recomendaciones);
      });

      this.socket.on('error', (error: any) => {
        console.error('WebSocket error:', error);
        this.errorSubject.next(error);
      });

      this.socket.on('connected', (data: any) => {
        console.log('Chat connected:', data);
      });

      // Escuchar detección de alergias
      this.socket.on('alergias_detectadas', (data: any) => {
        console.log('Alergias detectadas:', data);
        this.alergiasDetectadasSubject.next(data);
      });

    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.errorSubject.next(error);
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectionStatusSubject.next(false);
    }
  }

  sendMessage(message: { mensaje: string; sessionId?: string }): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('send_message', message);
    } else {
      console.error('WebSocket not connected');
      this.errorSubject.next({ message: 'WebSocket not connected' });
    }
  }

  // Métodos para suscribirse a eventos
  onMessage(): Observable<ChatResponse> {
    return this.messageSubject.asObservable();
  }

  onRecommendations(): Observable<ProductRecommendation[]> {
    return this.recommendationsSubject.asObservable();
  }

  onConnectionStatus(): Observable<boolean> {
    return this.connectionStatusSubject.asObservable();
  }

  onError(): Observable<any> {
    return this.errorSubject.asObservable();
  }

  onAlergiasDetectadas(): Observable<any> {
    return this.alergiasDetectadasSubject.asObservable();
  }

  // Métodos REST para funcionalidades adicionales
  sendMessageRest(message: { mensaje: string; sessionId?: string }): Observable<ChatResponse> {
    const headers = this.getAuthHeaders();
    return this.http.post<ChatResponse>(`${this.baseUrl}/chat/message`, message, { headers });
  }

  getChatHistory(sessionId?: string): Observable<ChatHistory[]> {
    const headers = this.getAuthHeaders();
    const url = sessionId 
      ? `${this.baseUrl}/chat/history/${sessionId}`
      : `${this.baseUrl}/chat/history`;
    return this.http.get<ChatHistory[]>(url, { headers });
  }

  clearChatHistory(): Observable<{ message: string }> {
    const headers = this.getAuthHeaders();
    return this.http.post<{ message: string }>(`${this.baseUrl}/chat/clear-history`, {}, { headers });
  }

  private getAuthHeaders(): HttpHeaders {
    // Sin JWT por ahora - solo Content-Type
    return new HttpHeaders({
      'Content-Type': 'application/json'
    });
  }

  // Métodos para manejar el estado de escritura
  sendTypingStatus(isTyping: boolean, sessionId?: string): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('typing', { isTyping, sessionId });
    }
  }

  // Método para obtener estadísticas de conexión
  getConnectionStats(): any {
    if (this.socket) {
      return {
        connected: this.socket.connected,
        id: this.socket.id,
        transport: this.socket.io.engine.transport.name
      };
    }
    return { connected: false };
  }
}
