package com.pingan.iobs.order.entity;

import javax.persistence.*;

@Entity
@Table(name = "t_order")
public class OrderEntity {
    @Id
    @Column(name = "id")
    private Long id;

    @Column(name = "order_no", nullable = false)
    private String orderNo;

    @Column(name = "status")
    private Integer status;
}
