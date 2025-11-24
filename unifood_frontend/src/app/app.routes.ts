import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { BorrarComponent } from './components/borrar/borrar.component';
import { authGuard } from './guards/auth.guard';
import { clienteGuard } from './guards/cliente.guard';
import { vendedorGuard } from './guards/vendedor.guard';
import { supervisorGuard } from './guards/supervisor.guard';
import { ClientePedidoComponent } from './components/cliente-pedido/cliente-pedido.component';
import { VendedorPedidoComponent } from './components/vendedor-pedido/vendedor-pedido.component';
import { MenuComponent } from './components/menu/menu.component';
import { ListaVendedoresComponent } from './components/lista-vendedores/lista-vendedores.component';
import { CrearVendedorComponent } from './components/crear-vendedor/crear-vendedor.component';
import { ClienteLayoutComponent } from './components/layouts/cliente-layout/cliente-layout.component';
import { VendedorLayoutComponent } from './components/layouts/vendedor-layout/vendedor-layout.component';
import { SupervisorLayoutComponent } from './components/layouts/supervisor-layout/supervisor-layout.component';
import { SupervisorDashboardComponent } from './components/supervisor-dashboard/supervisor-dashboard.component';
import { ChatComponent } from './components/chat/chat.component';
import { ReportePedidoComponent } from './components/reporte-pedido/reporte-pedido.component';
import { AreaVentaComponent } from './components/area-venta/area-venta.component';
import { CategoriaComponent } from './components/categoria/categoria.component';
import { ProductoComponent } from './components/producto/producto.component';
import { ClienteProductosComponent } from './components/cliente-productos/cliente-productos.component';
import { RecomendacionesHomeComponent } from './components/recomendaciones-home/recomendaciones-home.component';
import { SupervisorRecomendacionesComponent } from './components/supervisor-recomendaciones/supervisor-recomendaciones.component';
import { ClienteComponent } from './components/cliente/cliente.component';
import { SeguimientoPedidoComponent } from './components/seguimiento-pedido/seguimiento-pedido.component';

export const routes: Routes = [
  { path: '', redirectTo: 'lista-vendedores', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'registro-cliente', component: ClienteComponent},
  { path: 'borrar', component: BorrarComponent },
  { path: 'menu', component: MenuComponent },
  { path: 'crear-vendedor', component: CrearVendedorComponent },
  {path: 'seguimiento/:id',component: SeguimientoPedidoComponent},

  // ========== CLIENTE ==========
  {
    path: 'cliente',
    canActivate: [clienteGuard],
    component: ClienteLayoutComponent,
    children: [
      { path: '', redirectTo: 'recomendaciones', pathMatch: 'full' },
      { path: 'recomendaciones', component: RecomendacionesHomeComponent },
      { path: 'carrito', component: ClientePedidoComponent },
      { path: 'menu', component: MenuComponent },
      { path: 'productos', component: ClienteProductosComponent }
    ],
  },

  // ========== VENDEDOR ==========
  {
    path: 'vendedor',
    canActivate: [vendedorGuard],
    component: VendedorLayoutComponent,
    children: [
      { path: '', redirectTo: 'pedidos', pathMatch: 'full' },
      { path: 'pedidos', component: VendedorPedidoComponent },
      { path: 'lista-vendedores', component: ListaVendedoresComponent },
      { path: 'borrar', component: BorrarComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'reportes', component: ReportePedidoComponent },
      {path: 'crear-categoria', component: CategoriaComponent},
      {path: 'producto', component: ProductoComponent},
    ],
  },

  // ========== SUPERVISOR ==========
  {
    path: 'supervisor',
    canActivate: [supervisorGuard],
    component: SupervisorLayoutComponent,
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'lista-vendedores', component: ListaVendedoresComponent },
      {path: 'crear-vendedor', component: CrearVendedorComponent},
      { path: 'reportes', component: ReportePedidoComponent },
      { path: 'dashboard', component: SupervisorDashboardComponent },
      {path: 'crear-area-venta', component: AreaVentaComponent},
      {path: 'producto', component: ProductoComponent},
      {path: 'recomendaciones', component: SupervisorRecomendacionesComponent},
    ],
  },

  { path: '**', redirectTo: '/registro-cliente' },
];
