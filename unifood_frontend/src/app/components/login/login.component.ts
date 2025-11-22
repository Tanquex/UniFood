import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LoginRequest } from '../../models/auth.model';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  loginData: LoginRequest = {
    correo_electronico: '',
    contrasena: '',
  };

  cargando = false;

  constructor(private authService: AuthService, private router: Router) {
    if (this.authService.estaAutenticado()) {
      this.router.navigate(['/lista-vendedores']); // si ya esta autenticado redirige (cambiar ruta)
    }
  }

  iniciarSesion(): void {
    // Validar campos vacíos
    if (!this.loginData.correo_electronico || !this.loginData.contrasena) {
      Swal.fire({
        icon: 'warning',
        title: 'Campos incompletos',
        text: 'Por favor completa todos los campos',
        confirmButtonColor: '#667eea',
      });
      return;
    }

    // Validar de correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.loginData.correo_electronico)) {
      Swal.fire({
        icon: 'warning',
        title: 'Correo inválido',
        text: 'Por favor ingresa un correo electrónico válido',
        confirmButtonColor: '#667eea',
      });
      return;
    }

    this.cargando = true;

    this.authService.login(this.loginData).subscribe({
      next: (response) => {
        this.cargando = false;

        Swal.fire({
          icon: 'success',
          title: '¡Bienvenido!',
          text: `sesion iniciada como ${response.usuario.rol}`,
          timer: 1500,
          showConfirmButton: false,
        }).then(() => {
          // Redirigir según el rol
          if (this.authService.esSupervisor()) {
            this.router.navigate(['/supervisor']);
          } else if (this.authService.esVendedor()) {
            this.router.navigate(['/vendedor']);
          } else if (this.authService.esCliente()) {
            this.router.navigate(['/cliente/']);
          }
        });
      },
      error: (err) => {
        this.cargando = false;

        let mensaje = 'Error al iniciar sesión. Intenta de nuevo.';

        if (err.status === 401) {
          mensaje = 'Correo o contraseña incorrectos';
        } else if (err.status === 0) {
          mensaje = 'No se pudo conectar con el servidor';
        }

        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: mensaje,
          confirmButtonColor: '#667eea',
        });
      },
    });
  }

  irRegistroCliente(){
    this.router.navigate(['registro-cliente']);
  }

  /**
   * irACarrito(): void {
    this.menuAbierto = false;
    this.router.navigate(['/cliente/carrito']);
  }
   */
}
