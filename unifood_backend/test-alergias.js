// Script de prueba para el sistema de alergias
// Ejecutar: node test-alergias.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAlergias() {
  console.log('🧪 Iniciando pruebas de alergias...\n');
  console.log('='.repeat(60));

  try {
    // 1. Buscar un cliente de prueba
    console.log('\n📋 Paso 1: Buscando cliente de prueba...');
    const cliente = await prisma.cliente.findFirst({
      include: { usuario: true }
    });

    if (!cliente) {
      console.log('❌ No se encontró ningún cliente. Crea uno primero.');
      console.log('   Puedes crear uno desde el frontend o directamente en la BD.');
      return;
    }

    console.log(`✅ Cliente encontrado:`);
    console.log(`   - Nombre: ${cliente.nombre_completo}`);
    console.log(`   - ID: ${cliente.id}`);
    console.log(`   - Usuario ID: ${cliente.usuario_id}`);
    console.log(`   - Alergias actuales:`, cliente.alergia ? JSON.stringify(cliente.alergia) : 'Ninguna');
    console.log('');

    // 2. Buscar productos con ingredientes
    console.log('📦 Paso 2: Buscando productos con ingredientes...');
    const productos = await prisma.producto.findMany({
      where: { estado: true },
      take: 5,
      include: {
        categoria: true
      }
    });

    if (productos.length === 0) {
      console.log('❌ No se encontraron productos activos.');
      return;
    }

    console.log(`✅ Encontrados ${productos.length} productos:\n`);
    productos.forEach((p, index) => {
      console.log(`   ${index + 1}. ${p.nombre} (ID: ${p.id})`);
      console.log(`      Precio: $${p.precio}`);
      console.log(`      Categoría: ${p.categoria?.nombre || 'Sin categoría'}`);
      if (p.ingredientes) {
        const ingredientes = Array.isArray(p.ingredientes) 
          ? p.ingredientes 
          : (typeof p.ingredientes === 'string' ? JSON.parse(p.ingredientes) : []);
        console.log(`      Ingredientes: ${ingredientes.join(', ')}`);
      } else {
        console.log(`      ⚠️  Sin ingredientes registrados`);
      }
      console.log('');
    });

    // 3. Simular detección de alergias
    console.log('🔍 Paso 3: Simulando detección de alergias...');
    const alergiasTest = ['gluten', 'lactosa'];
    
    await prisma.$executeRaw`
      UPDATE cliente 
      SET alergia = ${JSON.stringify(alergiasTest)}::jsonb
      WHERE id = ${cliente.id}
    `;

    console.log(`✅ Alergias actualizadas: ${alergiasTest.join(', ')}`);
    console.log('');

    // 4. Verificar productos problemáticos
    console.log('⚠️  Paso 4: Verificando productos problemáticos...\n');
    const productosProblematicos = [];

    for (const producto of productos) {
      if (!producto.ingredientes) {
        continue;
      }

      const ingredientes = Array.isArray(producto.ingredientes) 
        ? producto.ingredientes 
        : (typeof producto.ingredientes === 'string' 
          ? JSON.parse(producto.ingredientes) 
          : []);

      if (ingredientes.length === 0) {
        continue;
      }

      const ingredientesStr = ingredientes.join(' ').toLowerCase();
      const problemas = [];

      // Verificar gluten
      if (ingredientesStr.includes('trigo') || 
          ingredientesStr.includes('gluten') || 
          ingredientesStr.includes('harina de trigo') ||
          ingredientesStr.includes('cebada') ||
          ingredientesStr.includes('centeno')) {
        problemas.push('gluten');
      }

      // Verificar lactosa
      if (ingredientesStr.includes('leche') || 
          ingredientesStr.includes('queso') || 
          ingredientesStr.includes('lactosa') ||
          ingredientesStr.includes('mantequilla') ||
          ingredientesStr.includes('crema') ||
          ingredientesStr.includes('yogur') ||
          ingredientesStr.includes('yogurt')) {
        problemas.push('lactosa');
      }

      if (problemas.length > 0) {
        productosProblematicos.push({
          producto,
          problemas,
          ingredientes
        });
      }
    }

    if (productosProblematicos.length > 0) {
      console.log('⚠️  Productos que pueden causar reacciones alérgicas:\n');
      productosProblematicos.forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.producto.nombre}`);
        console.log(`      Alergias detectadas: ${item.problemas.join(', ')}`);
        console.log(`      Ingredientes problemáticos: ${item.ingredientes.filter(ing => {
          const ingLower = ing.toLowerCase();
          return item.problemas.some(prob => {
            if (prob === 'gluten') {
              return ingLower.includes('trigo') || ingLower.includes('gluten') || 
                     ingLower.includes('cebada') || ingLower.includes('centeno');
            }
            if (prob === 'lactosa') {
              return ingLower.includes('leche') || ingLower.includes('queso') || 
                     ingLower.includes('lactosa') || ingLower.includes('mantequilla') ||
                     ingLower.includes('crema') || ingLower.includes('yogur');
            }
            return false;
          });
        }).join(', ')}`);
        console.log('');
      });
    } else {
      console.log('✅ No se encontraron productos problemáticos con las alergias actuales.');
      console.log('');
    }

    // 5. Resumen
    console.log('='.repeat(60));
    console.log('📊 RESUMEN DE PRUEBAS');
    console.log('='.repeat(60));
    console.log(`✅ Cliente: ${cliente.nombre_completo} (ID: ${cliente.id})`);
    console.log(`✅ Alergias registradas: ${alergiasTest.join(', ')}`);
    console.log(`✅ Productos analizados: ${productos.length}`);
    console.log(`⚠️  Productos problemáticos: ${productosProblematicos.length}`);
    console.log('');

    console.log('📝 Próximos pasos para probar:');
    console.log('   1. Prueba crear un pedido con un producto problemático');
    console.log('      → Debe fallar con AlergiasDetectadasException');
    console.log('');
    console.log('   2. Prueba crear un pedido con un producto seguro');
    console.log('      → Debe crearse exitosamente');
    console.log('');
    console.log('   3. Prueba el chat mencionando alergias:');
    console.log('      → "Soy alérgico al gluten"');
    console.log('      → "Tengo intolerancia a la lactosa"');
    console.log('      → Debe detectar y guardar automáticamente');
    console.log('');

  } catch (error) {
    console.error('❌ Error en las pruebas:', error);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
    console.log('✅ Conexión cerrada.');
  }
}

// Ejecutar pruebas
testAlergias()
  .then(() => {
    console.log('\n✅ Pruebas completadas exitosamente!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

