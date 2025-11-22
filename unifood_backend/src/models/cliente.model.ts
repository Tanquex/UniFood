import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, Matches, IsOptional, IsArray  } from 'class-validator';

export class CreateClienteDto {
  @IsEmail({}, { message: 'Debe proporcionar un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  correo_electronico: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  contrasena: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  @MaxLength(255, { message: 'El nombre no puede exceder 255 caracteres' })
  nombre_completo: string;

  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio' })
  @MaxLength(20, { message: 'El teléfono no puede exceder 20 caracteres' })
  @Matches(/^[0-9+\-\s()]*$/, { message: 'El teléfono solo puede contener números y símbolos válidos' })
  telefono: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  alergias?: string[];
}