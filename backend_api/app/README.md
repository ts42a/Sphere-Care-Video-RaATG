The SphereCare system is designed as a modular, multi-tiered web application with clear separation of concerns to ensure scalability, maintainability, and ease of future extension. 
The architecture is divided into four primary layers: Streamlit / Gradio,FastAPI(Python), PostgreSQL + SQLAlchemy, Docker + Docker Compose.
Streamlit / Gradio: Quickly build interactive web interfaces without front-end frameworks (React/Vue), using pure Python for development.
FastAPI(Python): Provide RESTful APIs, handle business logic, data validation, and permission control.
PostgreSQL + SQLAlchemy: Persistently store data, simplify database operations through ORM, and ensure data integrity.
Docker + Docker Compose: Containerized deployment, unifying development/testing/production environments, and supporting rapid deployment and scaling.
