FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download

COPY apps/settlement ./

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/settlement ./cmd/settlement

FROM alpine:3.20

RUN apk add --no-cache tzdata ca-certificates

WORKDIR /app

COPY --from=builder /out/settlement /app/settlement
RUN ln -s /app/settlement /usr/local/bin/settlement

ENV PATH="/app:${PATH}"

EXPOSE 8091

CMD ["./settlement", "daemon"]
