package db

import (
	"log"
	"vibemeter/config"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

var DB *sqlx.DB

func InitDB() {
	var err error
	DB, err = sqlx.Connect("postgres", config.C.DatabaseURL)
	if err != nil {
		log.Fatal("DB connection failed:", err)
	}
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)
	log.Println("Connected to DB")
}
