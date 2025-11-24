import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SeguimientoPedidoComponent } from './seguimiento-pedido.component';

describe('SeguimientoPedidoComponent', () => {
  let component: SeguimientoPedidoComponent;
  let fixture: ComponentFixture<SeguimientoPedidoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SeguimientoPedidoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SeguimientoPedidoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
