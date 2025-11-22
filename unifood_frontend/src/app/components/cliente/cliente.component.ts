import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { ClienteService } from '../../services/cliente.service';

@Component({
  selector: 'app-cliente',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './cliente.component.html',
  styleUrls: ['./cliente.component.scss'],
})
export class ClienteComponent {
  private fb = inject(FormBuilder);
  private clienteService = inject(ClienteService);
  private router = inject(Router);

  registroForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  alergias: string[] = [];
  alergiasSugeridas = [
    // Alérgenos clásicos
    'Gluten',
    'Trigo',
    'Cebada',
    'Centeno',
    'Avena',
    'Lactosa',
    'Proteína de la leche (caseína)',
    'Huevo',
    'Maní (cacahuate)',
    'Nueces',
    'Almendra',
    'Nuez de la India',
    'Nuez de Nogal',
    'Pistache',
    'Avellana',
    'Soya',
    'Sésamo',
    'Pescado',
    'Mariscos',
    'Camarón',
    'Moluscos',

    // Aditivos químicos y componentes comunes en cafeterías
    'Colorantes artificiales',
    'Saborizantes artificiales',
    'Conservadores',
    'Sulfatos',
    'Sulfitos',
    'Nitritos',
    'Glutamato monosódico (GMS)',
    'Aspartame',
    'Acesulfame K',
    'Sucralosa',

    // Sensibilidades e intolerancias comunes
    'Intolerancia al gluten',
    'Intolerancia a la lactosa',
    'Intolerancia a la fructosa',
    'Sensibilidad al café o cafeína',
    'Sensibilidad a alimentos picantes',
    'Sensibilidad a lo ácido (jitomate, cítricos)',
    'Sensibilidad a alimentos fritos o aceitosos',

    // Ingredientes frecuentes en cafeterías y antojitos
    'Chocolate',
    'Cacao',
    'Vainilla',
    'Canela',
    'Miel',
    'Jarabe de maíz alta fructosa',
    'Crema de avellanas (tipo Nutella)',
    'Coco',
    'Maíz',

    // Alergias a vegetales, raras pero existen
    'Apio',
    'Mostaza',
    'Tomate',
    'Chile',
    'Aguacate',
    'Cebolla',
    'Ajo',

    // Carnes y proteínas que pueden causar reacción
    'Carne de res',
    'Carne de cerdo',
    'Pollo',
    'Huevo crudo (en salsas o preparaciones especiales)',

    // Altramuces (lupin)
    'Altramuces',

    // Otros presentes en panadería y repostería
    'Levadura',
    'Gelatina (de origen animal)',
    'Pectina',
    'Harinas refinadas',
    'Aceites hidrogenados',

    // Bebidas y cafés
    'Cafeína',
    'Leche entera',
    'Leche deslactosada',
    'Leche de almendra',
    'Leche de soya',
    'Leche de coco',
    'Edulcorantes de café',

    // Salsas y condimentos comunes en antojitos y lonches
    'Salsa inglesa',
    'Salsa de soya',
    'Mayonesa',
    'Mostaza preparada',
    'Catsup',
    'Aderezos (ranch, chipotle, cesar)',
    'Vinagre',
    'Chiles en vinagre',

    // Mexicanos
    'Epazote',
    'Cilantro',
    'Comino',
    'Orégano',
    'Mole (mezcla compleja con nueces o semillas)',
    'Pepita de calabaza',
    'Semillas de girasol',
  ];

  alergiasFiltradas: string[] = [];
  mostrarSugerencias = false;

  constructor() {
    this.registroForm = this.fb.group(
      {
        correo_electronico: ['', [Validators.required, Validators.email]],
        contrasena: ['', [Validators.required, Validators.minLength(6)]],
        confirmar_contrasena: ['', [Validators.required]],
        nombre_completo: ['', [Validators.required, Validators.maxLength(255)]],
        telefono: [
          '',
          [
            Validators.required,
            Validators.pattern(/^[0-9+\-\s()]*$/),
            Validators.maxLength(20),
          ],
        ],
        alergia_input: [''],
      },
      {
        validators: this.passwordMatchValidator,
      }
    );
  }

  passwordMatchValidator(group: FormGroup) {
    const password = group.get('contrasena')?.value;
    const confirmPassword = group.get('confirmar_contrasena')?.value;
    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  onSubmit(): void {
    if (this.registroForm.invalid) {
      this.registroForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const { confirmar_contrasena, alergia_input, ...datosRegistro } =
      this.registroForm.value;

    const datosCompletos = {
      ...datosRegistro,
      ...(this.alergias.length > 0 && { alergias: this.alergias }),
    };

    this.clienteService.registrarCliente(datosCompletos).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.successMessage = 'Registro exitoso. Redirigiendo al login...';
        this.registroForm.reset();
        this.alergias = [];

        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 2000);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error.error?.message ||
          'Error al registrar el cliente. Intente nuevamente.';
      },
    });
  }

  filtrarAlergias(): void {
    const input =
      this.registroForm.get('alergia_input')?.value?.toLowerCase() || '';
    if (input.length > 0) {
      this.alergiasFiltradas = this.alergiasSugeridas.filter(
        (alergia) =>
          alergia.toLowerCase().includes(input) &&
          !this.alergias.includes(alergia)
      );
      this.mostrarSugerencias = this.alergiasFiltradas.length > 0;
    } else {
      this.alergiasFiltradas = [];
      this.mostrarSugerencias = false;
    }
  }

  seleccionarAlergia(alergia: string): void {
    if (!this.alergias.includes(alergia)) {
      this.alergias.push(alergia);
      this.registroForm.get('alergia_input')?.setValue('');
      this.alergiasFiltradas = [];
      this.mostrarSugerencias = false;
    }
  }

  agregarAlergia(): void {
    const alergiaInput = this.registroForm.get('alergia_input')?.value?.trim();
    if (alergiaInput && !this.alergias.includes(alergiaInput)) {
      this.alergias.push(alergiaInput);
      this.registroForm.get('alergia_input')?.setValue('');
      this.alergiasFiltradas = [];
      this.mostrarSugerencias = false;
    }
  }

  eliminarAlergia(index: number): void {
    this.alergias.splice(index, 1);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.registroForm.get(fieldName);

    if (field?.hasError('required')) {
      return 'Este campo es obligatorio';
    }

    if (field?.hasError('email')) {
      return 'Ingrese un correo electrónico válido';
    }

    if (field?.hasError('minlength')) {
      return `Mínimo ${field.errors?.['minlength'].requiredLength} caracteres`;
    }

    if (field?.hasError('maxlength')) {
      return `Máximo ${field.errors?.['maxlength'].requiredLength} caracteres`;
    }

    if (field?.hasError('pattern')) {
      return 'Formato inválido';
    }

    if (
      fieldName === 'confirmar_contrasena' &&
      this.registroForm.hasError('passwordMismatch')
    ) {
      return 'Las contraseñas no coinciden';
    }

    return '';
  }

  navigateToLogin(): void {
    this.router.navigate(['/login']);
  }
}
