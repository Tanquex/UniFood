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
      if (event.constructor.name !== 'NavigationEnd') return;

      const usuario = this.authService.obtenerUsuario();
      const autenticado = this.authService.estaAutenticado();

      const rutasPublicas = ['/login', '/registro-cliente'];

      if (!autenticado && !rutasPublicas.includes(this.router.url)) {
        this.router.navigate(['/login']);
        return;
      }

      if (autenticado && rutasPublicas.includes(this.router.url)) {
        if (usuario?.rol === 'cliente') {
          this.router.navigate(['/cliente']);
        } else if (usuario?.rol === 'vendedor') {
          this.router.navigate(['/vendedor']);
        } else if (usuario?.rol === 'supervisor') {
          this.router.navigate(['/supervisor']);
        } else {
          this.router.navigate(['/login']);
        }
        return;
      }
    },
  });
}

}
