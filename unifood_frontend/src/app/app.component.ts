import { Component, OnInit } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  constructor(private authService: AuthService, private router: Router) {}

  title = 'UniFood';

 ngOnInit(): void {
  this.router.events.subscribe({
    next: (event: any) => {
      // Solo ejecuta lógica al finalizar una navegación real
      if (event.constructor.name !== 'NavigationEnd') return;

      const usuario = this.authService.obtenerUsuario();
      const autenticado = this.authService.estaAutenticado();

      // Si no está autenticado y no está en login → redirige
      if (!autenticado && this.router.url !== '/login') {
        this.router.navigate(['/registro-cliente']);
        return;
      }

      // Si ya está autenticado y está en login o raíz → redirige según rol
      if (autenticado && (this.router.url === '/' || this.router.url === '/login')) {
        if (usuario?.rol === 'cliente') {
          this.router.navigate(['/cliente']);
        } else if (usuario?.rol === 'vendedor') {
          this.router.navigate(['/vendedor']);
        } else if (usuario?.rol === 'supervisor') {
          this.router.navigate(['/supervisor']);
        } else {
          this.router.navigate(['/login']);
        }
      }
    },
  });
}

}
