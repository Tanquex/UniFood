import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../enviroments/enviroment';

export interface RegistroClienteDto {
  correo_electronico: string;
  contrasena: string;
  nombre_completo: string;
  telefono: string;
  alergias?: string[];
}

export interface RegistroClienteResponse {
  success: boolean;
  data: {
    usuario_id: number;
    cliente_id: number;
    correo: string;
    nombre: string;
  };
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class ClienteService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/cliente`; // Ajusta según tu configuración

  registrarCliente(datos: RegistroClienteDto): Observable<RegistroClienteResponse> {
    return this.http.post<RegistroClienteResponse>(
      `${this.apiUrl}/registro`,
      datos
    );
  }
}