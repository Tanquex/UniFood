// qr.service.ts
import { Injectable } from '@angular/core';
import QRCode from 'qrcode';
import { environment } from '../../enviroments/enviroment';

@Injectable({ providedIn: 'root' })
export class QrService {
  async generarQR(pedidoId: number): Promise<string> {
    const url = `${environment.appUrl}/seguimiento/${pedidoId}`;
    
    
    try {
      // Genera QR como Data URL (base64)
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: {
          dark: '#5B9A97',
          light: '#FFFFFF',
        },
      });
      return qrDataUrl;
    } catch (error) {
      console.error('Error al generar QR:', error);
      throw error;
    }
  }
}