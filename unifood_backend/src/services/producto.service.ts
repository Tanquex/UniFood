import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateProductoDto, UpdateProductoDto, Producto } from '../models/producto.model';

@Injectable()
export class ProductoService {
  constructor(
    @Inject(DataSource)
    private dataSource: DataSource,
  ) {}

  async findAll(): Promise<Producto[]> {
    const result = await this.dataSource.query('SELECT * FROM producto');
    return result as Producto[];
  }

  async findOne(id: number): Promise<Producto> {
    const result = await this.dataSource.query(
      'SELECT * FROM producto WHERE id = $1',
      [id]
    );
    
    if (result.length === 0) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }
    return result[0] as Producto;
  }

  async create(createProductoDto: CreateProductoDto): Promise<Producto> {
    try {
      const {
        nombre,
        descripcion,
        precio,
        imagen_url,
        categoria_id,
        area_venta_id,
        estado,
        tiempo_preparacion,
        ingredientes,
        calorias,
        vendedorFK
      } = createProductoDto;
      
      const result = await this.dataSource.query(
        `INSERT INTO producto 
         (nombre, descripcion, precio, imagen_url, categoria_id, area_venta_id, 
          estado, tiempo_preparacion, ingredientes, calorias, vendedorfk) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          nombre,
          descripcion,
          precio,
          imagen_url,
          categoria_id,
          area_venta_id,
          estado ?? true,
          tiempo_preparacion,
          ingredientes ? JSON.stringify(ingredientes) : null, // CONVERTIR A JSON
          calorias,
          vendedorFK
        ]
      );
      
      return result[0] as Producto;
    } catch (error) {
      console.error('Error en ProductoService.create:', error);
      console.error('Error details:', error.message);
      console.error('Error code:', error.code);
      throw error;
    }
  }

  async update(id: number, updateProductoDto: UpdateProductoDto): Promise<Producto> {
    await this.findOne(id);
    
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;
    
    if (updateProductoDto.nombre !== undefined) {
      fields.push(`nombre = $${paramCount}`);
      values.push(updateProductoDto.nombre);
      paramCount++;
    }
    
    if (updateProductoDto.descripcion !== undefined) {
      fields.push(`descripcion = $${paramCount}`);
      values.push(updateProductoDto.descripcion);
      paramCount++;
    }
    
    if (updateProductoDto.precio !== undefined) {
      fields.push(`precio = $${paramCount}`);
      values.push(updateProductoDto.precio);
      paramCount++;
    }
    
    if (updateProductoDto.imagen_url !== undefined) {
      fields.push(`imagen_url = $${paramCount}`);
      values.push(updateProductoDto.imagen_url);
      paramCount++;
    }
    
    if (updateProductoDto.categoria_id !== undefined) {
      fields.push(`categoria_id = $${paramCount}`);
      values.push(updateProductoDto.categoria_id);
      paramCount++;
    }
    
    if (updateProductoDto.area_venta_id !== undefined) {
      fields.push(`area_venta_id = $${paramCount}`);
      values.push(updateProductoDto.area_venta_id);
      paramCount++;
    }
    
    if (updateProductoDto.estado !== undefined) {
      fields.push(`estado = $${paramCount}`);
      values.push(updateProductoDto.estado);
      paramCount++;
    }
    
    if (updateProductoDto.tiempo_preparacion !== undefined) {
      fields.push(`tiempo_preparacion = $${paramCount}`);
      values.push(updateProductoDto.tiempo_preparacion);
      paramCount++;
    }
    
    if (updateProductoDto.ingredientes !== undefined) {
      fields.push(`ingredientes = $${paramCount}`);
      values.push(updateProductoDto.ingredientes ? JSON.stringify(updateProductoDto.ingredientes) : null); // CONVERTIR A JSON
      paramCount++;
    }
    
    if (updateProductoDto.calorias !== undefined) {
      fields.push(`calorias = $${paramCount}`);
      values.push(updateProductoDto.calorias);
      paramCount++;
    }
    
    if (updateProductoDto.vendedorFK !== undefined) {
      fields.push(`vendedorfk = $${paramCount}`);
      values.push(updateProductoDto.vendedorFK);
      paramCount++;
    }
    
    if (fields.length === 0) {
      return await this.findOne(id);
    }
    
    values.push(id);
    const query = `UPDATE producto SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await this.dataSource.query(query, values);
    return result[0] as Producto;
  }

  async remove(id: number): Promise<void> {
    const result = await this.dataSource.query(
      'DELETE FROM producto WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.length === 0) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }
  }
}