#include <gtk/gtk.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ARQUIVO_PADRAO "estoque.csv"
#define ARQUIVO_USUARIOS "usuarios.txt"

// Estrutura para itens de estoque
struct itens {
    char nome[80];
    char serial[30];
    char setor[30];
};

// Função para verificar se um arquivo é CSV
int arquivo_eh_csv(const char *nome_arquivo) {
    const char *extensao = strrchr(nome_arquivo, '.');
    return (extensao && strcmp(extensao, ".csv") == 0);
}

// Verificar se o serial já existe no arquivo
int serial_existe(const char *serial) {
    FILE *fptr;
    char buffer[200];
    char serial_arquivo[30];

    fptr = fopen(ARQUIVO_PADRAO, "r");
    if (!fptr) {
        return 0; // Arquivo não encontrado, serial não pode existir
    }

    while (fgets(buffer, sizeof(buffer), fptr)) {
        sscanf(buffer, "%*[^;];%[^;];", serial_arquivo);
        serial_arquivo[strcspn(serial_arquivo, "\n")] = '\0';
        if (strcmp(serial_arquivo, serial) == 0) {
            fclose(fptr);
            return 1; // Serial encontrado
        }
    }

    fclose(fptr);
    return 0; // Serial não encontrado
}

// Função para remover um item do arquivo CSV
void remover_item(const char *serial) {
    FILE *fptr, *temp;
    char buffer[200];
    char serial_arquivo[30];

    fptr = fopen(ARQUIVO_PADRAO, "r");
    if (!fptr) {
        printf("Erro ao abrir o arquivo CSV.\n");
        return;
    }

    temp = fopen("temp.csv", "w");
    if (!temp) {
        printf("Erro ao criar arquivo temporário.\n");
        fclose(fptr);
        return;
    }

    while (fgets(buffer, sizeof(buffer), fptr)) {
        sscanf(buffer, "%*[^;];%[^;];", serial_arquivo);
        serial_arquivo[strcspn(serial_arquivo, "\n")] = '\0';
        if (strcmp(serial_arquivo, serial) != 0) {
            fputs(buffer, temp);
        }
    }

    fclose(fptr);
    fclose(temp);

    // Substituir o arquivo original pelo arquivo temporário
    remove(ARQUIVO_PADRAO);
    rename("temp.csv", ARQUIVO_PADRAO);
}

// Função para editar um item no arquivo CSV
void editar_item(const char *serial, const char *novo_nome, const char *novo_setor) {
    FILE *fptr, *temp;
    char buffer[200];
    char serial_arquivo[30];

    fptr = fopen(ARQUIVO_PADRAO, "r");
    if (!fptr) {
        printf("Erro ao abrir o arquivo CSV.\n");
        return;
    }

    temp = fopen("temp.csv", "w");
    if (!temp) {
        printf("Erro ao criar arquivo temporário.\n");
        fclose(fptr);
        return;
    }

    while (fgets(buffer, sizeof(buffer), fptr)) {
        sscanf(buffer, "%*[^;];%[^;];", serial_arquivo);
        serial_arquivo[strcspn(serial_arquivo, "\n")] = '\0';
        if (strcmp(serial_arquivo, serial) == 0) {
            fprintf(temp, "%s;%s;%s\n", novo_nome, serial, novo_setor); // Edita o item
        } else {
            fputs(buffer, temp);
        }
    }

    fclose(fptr);
    fclose(temp);

    remove(ARQUIVO_PADRAO);
    rename("temp.csv", ARQUIVO_PADRAO);
}

// Verificar se um usuário já existe no arquivo
int usuario_existe(const char *usuario) {
    FILE *fptr = fopen(ARQUIVO_USUARIOS, "r");
    char buffer[100];
    char usuario_arquivo[50];

    if (!fptr) {
        return 0; // Arquivo não encontrado
    }

    while (fgets(buffer, sizeof(buffer), fptr)) {
        sscanf(buffer, "%[^;];", usuario_arquivo);
        if (strcmp(usuario_arquivo, usuario) == 0) {
            fclose(fptr);
            return 1; // Usuário encontrado
        }
    }

    fclose(fptr);
    return 0; // Usuário não encontrado
}

// Callback para adicionar um item ao estoque
void ao_adicionar_item(GtkWidget *widget, gpointer dados) {
    GtkWidget **entradas = (GtkWidget **)dados;
    const gchar *nome = gtk_entry_get_text(GTK_ENTRY(entradas[0]));
    const gchar *serial = gtk_entry_get_text(GTK_ENTRY(entradas[1]));
    const gchar *setor = gtk_entry_get_text(GTK_ENTRY(entradas[2]));

    if (strlen(nome) == 0 || strlen(serial) == 0 || strlen(setor) == 0) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Todos os campos são obrigatórios.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    if (serial_existe(serial)) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "O serial informado já existe.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    FILE *arquivo = fopen(ARQUIVO_PADRAO, "a");
    if (!arquivo) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Erro ao abrir o arquivo CSV.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    fprintf(arquivo, "%s;%s;%s\n", nome, serial, setor);
    fclose(arquivo);

    GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_INFO, GTK_BUTTONS_OK,
                                                "Item adicionado com sucesso!");
    gtk_dialog_run(GTK_DIALOG(dialogo));
    gtk_widget_destroy(dialogo);

    gtk_entry_set_text(GTK_ENTRY(entradas[0]), "");
    gtk_entry_set_text(GTK_ENTRY(entradas[1]), "");
    gtk_entry_set_text(GTK_ENTRY(entradas[2]), "");
}

// Callback para cadastro
void ao_cadastrar(GtkWidget *widget, gpointer dados) {
    GtkWidget **entradas = (GtkWidget **)dados;
    const gchar *usuario = gtk_entry_get_text(GTK_ENTRY(entradas[0]));
    const gchar *senha = gtk_entry_get_text(GTK_ENTRY(entradas[1]));

    if (strlen(usuario) == 0 || strlen(senha) == 0) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[2]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Todos os campos são obrigatórios.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    if (usuario_existe(usuario)) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[2]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Usuário já cadastrado.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    FILE *arquivo = fopen(ARQUIVO_USUARIOS, "a");
    if (!arquivo) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[2]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Erro ao salvar o cadastro.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    fprintf(arquivo, "%s;%s\n", usuario, senha);
    fclose(arquivo);

    GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[2]), GTK_DIALOG_MODAL, GTK_MESSAGE_INFO, GTK_BUTTONS_OK,
                                                "Cadastro realizado com sucesso!");
    gtk_dialog_run(GTK_DIALOG(dialogo));
    gtk_widget_destroy(dialogo);
}

// Callback para remover um item
void ao_remover_item(GtkWidget *widget, gpointer dados) {
    GtkWidget **entradas = (GtkWidget **)dados;
    const gchar *serial = gtk_entry_get_text(GTK_ENTRY(entradas[0]));  // Entrada de Serial

    if (strlen(serial) == 0) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[1]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "O campo de Serial é obrigatório.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    if (!serial_existe(serial)) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[1]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Serial não encontrado no estoque.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    remover_item(serial);

    GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[1]), GTK_DIALOG_MODAL, GTK_MESSAGE_INFO, GTK_BUTTONS_OK,
                                                "Item removido com sucesso!");
    gtk_dialog_run(GTK_DIALOG(dialogo));
    gtk_widget_destroy(dialogo);
}

// Callback para editar um item
void ao_editar_item(GtkWidget *widget, gpointer dados) {
    GtkWidget **entradas = (GtkWidget **)dados;
    const gchar *serial = gtk_entry_get_text(GTK_ENTRY(entradas[0]));   // Entrada de Serial
    const gchar *novo_nome = gtk_entry_get_text(GTK_ENTRY(entradas[1])); // Entrada de Nome
    const gchar *novo_setor = gtk_entry_get_text(GTK_ENTRY(entradas[2])); // Entrada de Setor

    if (strlen(serial) == 0 || strlen(novo_nome) == 0 || strlen(novo_setor) == 0) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Todos os campos são obrigatórios.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    if (!serial_existe(serial)) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Serial não encontrado no estoque.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    editar_item(serial, novo_nome, novo_setor);

    GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[3]), GTK_DIALOG_MODAL, GTK_MESSAGE_INFO, GTK_BUTTONS_OK,
                                                "Item editado com sucesso!");
    gtk_dialog_run(GTK_DIALOG(dialogo));
    gtk_widget_destroy(dialogo);
}

// Callback para login
void ao_tentar_login(GtkWidget *widget, gpointer dados) {
    GtkWidget **entradas = (GtkWidget **)dados;
    const gchar *usuario = gtk_entry_get_text(GTK_ENTRY(entradas[0]));
    const gchar *senha = gtk_entry_get_text(GTK_ENTRY(entradas[1]));

    FILE *fptr = fopen(ARQUIVO_USUARIOS, "r");
    char buffer[100];
    char usuario_arquivo[50], senha_arquivo[50];

    if (!fptr) {
        GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[2]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                    "Erro ao abrir o arquivo de usuários.");
        gtk_dialog_run(GTK_DIALOG(dialogo));
        gtk_widget_destroy(dialogo);
        return;
    }

    while (fgets(buffer, sizeof(buffer), fptr)) {
        sscanf(buffer, "%[^;];%s", usuario_arquivo, senha_arquivo);
        if (strcmp(usuario, usuario_arquivo) == 0 && strcmp(senha, senha_arquivo) == 0) {
            fclose(fptr);
            gtk_widget_hide(entradas[2]); // Esconde a janela de login
            gtk_widget_show_all(GTK_WIDGET(entradas[3])); // Mostra a janela principal
            return;
        }
    }

    fclose(fptr);
    GtkWidget *dialogo = gtk_message_dialog_new(GTK_WINDOW(entradas[2]), GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_OK,
                                                "Usuário ou senha incorretos.");
    gtk_dialog_run(GTK_DIALOG(dialogo));
    gtk_widget_destroy(dialogo);
}

// Função principal
int main(int argc, char *argv[]) {
    GtkWidget *janela_login, *grade_login;
    GtkWidget *entrada_usuario, *entrada_senha, *botao_login, *botao_cadastro;
    GtkWidget *janela_principal, *grade_principal;
    GtkWidget *entrada_nome, *entrada_serial, *entrada_setor, *botao_adicionar;

    gtk_init(&argc, &argv);

    // Janela de login
    janela_login = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(janela_login), "Login");
    gtk_window_set_default_size(GTK_WINDOW(janela_login), 300, 200);
    g_signal_connect(janela_login, "destroy", G_CALLBACK(gtk_main_quit), NULL);

    grade_login = gtk_grid_new();
    gtk_grid_set_row_spacing(GTK_GRID(grade_login), 10);
    gtk_grid_set_column_spacing(GTK_GRID(grade_login), 10);
    gtk_container_add(GTK_CONTAINER(janela_login), grade_login);

    entrada_usuario = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(entrada_usuario), "Usuário");
    gtk_grid_attach(GTK_GRID(grade_login), entrada_usuario, 0, 0, 1, 1);

    entrada_senha = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(entrada_senha), "Senha");
    gtk_entry_set_visibility(GTK_ENTRY(entrada_senha), FALSE);
    gtk_grid_attach(GTK_GRID(grade_login), entrada_senha, 0, 1, 1, 1);

    botao_login = gtk_button_new_with_label("Login");
    gtk_grid_attach(GTK_GRID(grade_login), botao_login, 0, 2, 1, 1);

    botao_cadastro = gtk_button_new_with_label("Cadastrar");
    gtk_grid_attach(GTK_GRID(grade_login), botao_cadastro, 0, 3, 1, 1);

    // Janela principal
    janela_principal = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(janela_principal), "Controle de Estoque");
    gtk_window_set_default_size(GTK_WINDOW(janela_principal), 400, 300);
    g_signal_connect(janela_principal, "destroy", G_CALLBACK(gtk_main_quit), NULL);

    grade_principal = gtk_grid_new();
    gtk_grid_set_row_spacing(GTK_GRID(grade_principal), 10);
    gtk_grid_set_column_spacing(GTK_GRID(grade_principal), 10);
    gtk_container_add(GTK_CONTAINER(janela_principal), grade_principal);

    // Botão Remover Item
    GtkWidget *botao_remover = gtk_button_new_with_label("Remover Item");
    gtk_grid_attach(GTK_GRID(grade_principal), botao_remover, 0, 4, 1, 1);

    // Botão Editar Item
    GtkWidget *botao_editar = gtk_button_new_with_label("Editar Item");
    gtk_grid_attach(GTK_GRID(grade_principal), botao_editar, 0, 5, 1, 1);

    entrada_nome = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(entrada_nome), "Nome do Produto");
    gtk_grid_attach(GTK_GRID(grade_principal), entrada_nome, 0, 0, 1, 1);

    entrada_serial = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(entrada_serial), "Serial");
    gtk_grid_attach(GTK_GRID(grade_principal), entrada_serial, 0, 1, 1, 1);

    entrada_setor = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(entrada_setor), "Setor");
    gtk_grid_attach(GTK_GRID(grade_principal), entrada_setor, 0, 2, 1, 1);

    botao_adicionar = gtk_button_new_with_label("Adicionar Item");
    gtk_grid_attach(GTK_GRID(grade_principal), botao_adicionar, 0, 3, 1, 1);

    // Conectar os botões aos callbacks
    GtkWidget *entradas[] = {entrada_serial, entrada_nome, entrada_setor, janela_principal};

    g_signal_connect(botao_remover, "clicked", G_CALLBACK(ao_remover_item), entradas);
    g_signal_connect(botao_editar, "clicked", G_CALLBACK(ao_editar_item), entradas);

    // Conectando o botão Adicionar
    GtkWidget *entradas_principal[] = {entrada_nome, entrada_serial, entrada_setor, janela_principal};
    g_signal_connect(botao_adicionar, "clicked", G_CALLBACK(ao_adicionar_item), entradas_principal);

    // Conectando o botão Login
    GtkWidget *entradas_login[] = {entrada_usuario, entrada_senha, janela_login, janela_principal};
    g_signal_connect(botao_login, "clicked", G_CALLBACK(ao_tentar_login), entradas_login);

    // Conectando o botão Cadastro
    GtkWidget *entradas_cadastro[] = {entrada_usuario, entrada_senha, janela_login};
    g_signal_connect(botao_cadastro, "clicked", G_CALLBACK(ao_cadastrar), entradas_cadastro);

    gtk_widget_show_all(janela_login);

    gtk_main();

    return 0;
}
