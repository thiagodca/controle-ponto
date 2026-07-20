import React, { useState, useEffect } from 'react';
import { Clock, Users, FileText, LogOut, LogIn, UserPlus, Edit2, Trash2, Save, X, Plus, Search, Download, MapPin, AlertTriangle, Wrench, Stethoscope, PartyPopper, Palmtree, Home, CalendarClock } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Identificador de versão — usado para confirmar visualmente qual versão do código está rodando
const APP_VERSION = 'v6.2-fix-header-safearea';

// Ícone customizado do marcador (evita o bug clássico do Leaflet + Vite com os
// ícones padrão, que não carregam corretamente após o build).
const marcadorIcon = L.divIcon({
  html: '<div style="font-size: 36px; line-height: 1; transform: translateY(-8px);">📍</div>',
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

// Configuração do banco de dados (Supabase)
const SUPABASE_URL = 'https://rnabihjpvnvyrvpwpyjv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mm_lgPs-Zvni1xmdNEvZxA_ZlmbXYHN';

// Função auxiliar para chamadas à API REST do Supabase (PostgREST)
const supabaseRequest = async (table, method = 'GET', { query = '', body = null } = {}) => {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method !== 'GET' && method !== 'DELETE') {
    headers['Prefer'] = 'return=representation';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Banco de dados (${method} ${table}) falhou: ${response.status} — ${errorText}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

// Conversores entre o formato do banco (snake_case) e o formato usado no app (camelCase)
const dbUserToApp = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  profile: u.profile,
  firstAccess: u.first_access,
});

const dbRecordToApp = (r) => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  date: r.date,
  time: r.time,
  datetime: r.datetime,
  type: r.type,
  latitude: r.latitude,
  longitude: r.longitude,
  address: r.address,
  manuallyAdjusted: r.manually_adjusted || false,
  adjustmentReason: r.adjustment_reason || null,
});

// Obtém a localização atual do navegador (com timeout) e retorna coordenadas.
// Se a pessoa negar a permissão ou o dispositivo não suportar, retorna null
// em vez de travar o registro de ponto — a localização é um "extra", não deve
// impedir o funcionário de bater o ponto.
// Verifica o estado atual da permissão de geolocalização, sem disparar o
// pedido de permissão do navegador. Retorna 'granted', 'denied', 'prompt'
// (ainda não decidido) ou 'unknown' (navegador não suporta essa checagem).
const checkGeoPermission = async () => {
  if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
};

const getCurrentPosition = () => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ position: null, errorReason: 'Navegador não suporta geolocalização' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          position: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          errorReason: null,
        });
      },
      (error) => {
        // Reporta o motivo exato da falha, para sabermos se foi permissão
        // negada, GPS indisponível, ou tempo esgotado.
        const motivos = {
          1: 'Permissão de localização negada',
          2: 'Localização indisponível no dispositivo',
          3: 'Tempo esgotado ao obter localização',
        };
        resolve({ position: null, errorReason: motivos[error.code] || 'Erro desconhecido de localização' });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
};

// Converte coordenadas em um endereço legível usando o serviço gratuito
// Nominatim (OpenStreetMap). Se falhar, retorna null (não bloqueia o ponto).
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'pt-BR' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.display_name || null;
  } catch (error) {
    console.warn('Não foi possível obter o endereço:', error.message);
    return null;
  }
};

const ControlePonto = () => {
  // Estado para autenticação
  const [currentUser, setCurrentUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Estado para navegação
  const [activeView, setActiveView] = useState('clock');
  
  // Estado para usuários
  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', profile: 'employee' });
  const [showUserForm, setShowUserForm] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userMenuOpenId, setUserMenuOpenId] = useState(null);
  const [confirmResetPasswordUser, setConfirmResetPasswordUser] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  
  // Estado para registros de ponto
  const [timeRecords, setTimeRecords] = useState([]);
  const [holidays, setHolidays] = useState([]); // array de {date, description}
  const [medicalCertificates, setMedicalCertificates] = useState([]); // [{id, userId, date, hours, justification}]
  const [vacations, setVacations] = useState([]); // [{id, userId, userName, startDate, endDate}]
  const [overtimeAlerts, setOvertimeAlerts] = useState([]); // [{id, userId, userName, type, thresholdHours}]
  
  // Estado para relatório — mês e ano do relatório vêm pré-selecionados com o mês atual
  const nowParaDefaults = new Date();
  const [reportUser, setReportUser] = useState('');
  const [reportMonth, setReportMonth] = useState(String(nowParaDefaults.getMonth() + 1).padStart(2, '0'));
  const [reportYear, setReportYear] = useState(String(nowParaDefaults.getFullYear()));

  // Estado para a tela "Meu Ponto" (funcionário vendo o próprio espelho de ponto)
  const [myReportMonth, setMyReportMonth] = useState(String(nowParaDefaults.getMonth() + 1).padStart(2, '0'));
  const [myReportYear, setMyReportYear] = useState(String(nowParaDefaults.getFullYear()));

  // Estado para a tela de Inconsistências
  const [inconsistencyUser, setInconsistencyUser] = useState('');
  const [inconsistencyMonth, setInconsistencyMonth] = useState(String(nowParaDefaults.getMonth() + 1).padStart(2, '0'));
  const [inconsistencyYear, setInconsistencyYear] = useState(String(nowParaDefaults.getFullYear()));

  // Estado para o modal de resolução/ajuste de ponto (usado tanto na tela de
  // Inconsistências quanto na tela de Relatório, para qualquer dia)
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveEhFeriado, setResolveEhFeriado] = useState(false);
  const [resolveOriginalDia, setResolveOriginalDia] = useState(null);
  const [resolveUserId, setResolveUserId] = useState('');
  const [resolveDate, setResolveDate] = useState('');
  const [resolveEntrada, setResolveEntrada] = useState('');
  const [resolveInicioIntervalo, setResolveInicioIntervalo] = useState('');
  const [resolveFimIntervalo, setResolveFimIntervalo] = useState('');
  const [resolveSaida, setResolveSaida] = useState('');
  const [resolveTemAtestado, setResolveTemAtestado] = useState(false);
  const [resolveAtestadoHoras, setResolveAtestadoHoras] = useState('');
  const [resolveJustificativa, setResolveJustificativa] = useState('');
  const [resolveError, setResolveError] = useState('');
  const [resolveSaving, setResolveSaving] = useState(false);
  
  // Estado de carregamento inicial e mensagens de erro (inline, não usa alert)
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [clockMessage, setClockMessage] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [storageAvailable, setStorageAvailable] = useState(true);

  // Carregar dados do Supabase ao montar
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const usuarios = await supabaseRequest('usuarios', 'GET', { query: '?select=id,name,email,profile,first_access,created_at&order=created_at.asc' });
      const usuariosMapeados = (usuarios || []).map(dbUserToApp);
      setUsers(usuariosMapeados);

      const registros = await supabaseRequest('registros_ponto', 'GET', { query: '?select=*&order=datetime.asc' });
      setTimeRecords((registros || []).map(dbRecordToApp));

      const feriadosDb = await supabaseRequest('feriados', 'GET', { query: '?select=*' });
      setHolidays((feriadosDb || []).map(f => ({ date: f.date, description: f.description })));

      const atestadosDb = await supabaseRequest('atestados', 'GET', { query: '?select=*' });
      setMedicalCertificates((atestadosDb || []).map(a => ({
        id: a.id, userId: a.user_id, date: a.date, hours: parseFloat(a.hours), justification: a.justification
      })));

      const feriasDb = await supabaseRequest('ferias', 'GET', { query: '?select=*' });
      setVacations((feriasDb || []).map(v => ({
        id: v.id,
        userId: v.user_id,
        userName: usuariosMapeados.find(u => u.id === v.user_id)?.name || '(usuário removido)',
        startDate: v.start_date,
        endDate: v.end_date,
      })));

      const alertasDb = await supabaseRequest('alertas_horas_extras', 'GET', { query: '?select=*' });
      setOvertimeAlerts((alertasDb || []).map(a => ({
        id: a.id,
        userId: a.user_id,
        userName: usuariosMapeados.find(u => u.id === a.user_id)?.name || '(usuário removido)',
        type: a.type,
        thresholdHours: parseFloat(a.threshold_hours),
      })));

      setStorageAvailable(true);
    } catch (error) {
      console.error('Erro ao carregar dados do banco:', error);
      setLoadError(error.message || 'Falha ao conectar com o banco de dados.');
      setStorageAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Função de login
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setLoginError('');
    const emailNormalizado = String(loginEmail || '').trim().toLowerCase();
    const senhaDigitada = String(loginPassword || '');

    if (!emailNormalizado || !senhaDigitada) {
      setLoginError('Preencha e-mail e senha.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const resultado = await supabaseRequest('rpc/verify_login', 'POST', {
        body: { p_email: emailNormalizado, p_password: senhaDigitada }
      });

      const user = resultado && resultado[0]
        ? { id: resultado[0].id, name: resultado[0].name, email: resultado[0].email, profile: resultado[0].profile, firstAccess: resultado[0].first_access }
        : null;

      if (user) {
        if (user.firstAccess) {
          setLoginEmail(emailNormalizado);
          setShowPasswordSetup(true);
          setLoginPassword(''); // Limpa apenas a senha
        } else {
          setCurrentUser(user);
          setShowLogin(false);
          setActiveView(user.profile === 'admin' ? 'home' : 'clock');
          setLoginEmail('');
          setLoginPassword('');
        }
      } else {
        setLoginError('E-mail ou senha incorretos. Verifique e tente novamente.');
      }
    } catch (error) {
      console.error('Erro no login:', error);
      setLoginError('Erro inesperado ao entrar: ' + error.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Função para configurar senha no primeiro acesso
  const handlePasswordSetup = async () => {
    setPasswordError('');
    try {
      if (newPassword !== confirmPassword) {
        setPasswordError('As senhas não coincidem!');
        return;
      }
      if (newPassword.length < 4) {
        setPasswordError('A senha deve ter pelo menos 4 caracteres!');
        return;
      }
      
      if (!loginEmail) {
        setPasswordError('E-mail não encontrado. Volte e faça login novamente.');
        setShowPasswordSetup(false);
        return;
      }
      
      const emailNormalizado = String(loginEmail).trim().toLowerCase();
      const userAtual = users.find(u => String(u.email || '').trim().toLowerCase() === emailNormalizado);
      
      if (!userAtual) {
        setPasswordError('Usuário não encontrado. Tente fazer login novamente.');
        return;
      }

      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${userAtual.id}&select=id,name,email,profile,first_access`,
        body: { password: newPassword, first_access: false }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);

      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setCurrentUser(userAtualizado);
      setShowPasswordSetup(false);
      setShowLogin(false);
      setActiveView(userAtualizado.profile === 'admin' ? 'home' : 'clock');
      setNewPassword('');
      setConfirmPassword('');
      setLoginEmail('');
    } catch (error) {
      console.error('Erro ao configurar senha:', error);
      setPasswordError('Erro ao salvar a nova senha: ' + error.message);
    }
  };

  // Função de logout
  const handleLogout = () => {
    setCurrentUser(null);
    setShowLogin(true);
    setActiveView('clock');
    setLoginError('');
    setPasswordError('');
  };

  // Backup manual: baixa um arquivo .json com todos os dados (usuários e registros).
  // Serve como cópia de segurança independente do armazenamento automático —
  // pode ser guardado ou enviado por WhatsApp/e-mail se algo der errado.
  const handleExportBackup = () => {
    try {
      const backup = {
        exportedAt: new Date().toISOString(),
        users,
        timeRecords
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dataHoje = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `backup-controle-ponto-${dataHoje}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar backup:', error);
      alert('Não foi possível gerar o arquivo de backup.');
    }
  };

  // Restaura dados a partir de um arquivo .json exportado anteriormente,
  // recriando os registros no banco de dados (Supabase).
  const handleImportBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (!Array.isArray(backup.users)) {
          throw new Error('Arquivo inválido: não contém uma lista de usuários.');
        }
        if (!window.confirm(`Importar este backup vai ADICIONAR estes dados ao banco atual (não apaga o que já existe).\n\nUsuários no arquivo: ${backup.users.length}\nRegistros no arquivo: ${(backup.timeRecords || []).length}\nData do backup: ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('pt-BR') : 'desconhecida'}\n\nDeseja continuar?`)) {
          return;
        }
        alert('Importação de backup para o banco de dados ainda não está disponível nesta versão. Use "Novo Usuário" para recadastrar manualmente, se necessário.');
      } catch (error) {
        console.error('Erro ao importar backup:', error);
        alert('Não foi possível importar o arquivo: ' + error.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // Funções para gerenciamento de usuários
  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email) {
      alert('Preencha todos os campos!');
      return;
    }
    
    if (users.find(u => u.email.toLowerCase() === newUser.email.toLowerCase())) {
      alert('Este e-mail já está cadastrado!');
      return;
    }

    try {
      const inseridos = await supabaseRequest('usuarios', 'POST', {
        query: '?select=id,name,email,profile,first_access',
        body: {
          name: newUser.name,
          email: newUser.email.trim().toLowerCase(),
          password: '123456',
          profile: newUser.profile,
          first_access: true,
        }
      });
      const novoUsuario = dbUserToApp(inseridos[0]);
      setUsers([...users, novoUsuario]);
      setNewUser({ name: '', email: '', profile: 'employee' });
      setShowUserForm(false);
      alert('Usuário cadastrado com sucesso! Senha padrão: 123456');
    } catch (error) {
      console.error('Erro ao cadastrar usuário:', error);
      alert('Não foi possível cadastrar o usuário: ' + error.message);
    }
  };

  const handleEditUser = (user) => {
    setEditingUser({ ...user });
  };

  const handleSaveEdit = async () => {
    try {
      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${editingUser.id}&select=id,name,email,profile,first_access`,
        body: {
          name: editingUser.name,
          email: editingUser.email.trim().toLowerCase(),
          profile: editingUser.profile,
        }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);
      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setEditingUser(null);
    } catch (error) {
      console.error('Erro ao salvar edição:', error);
      alert('Não foi possível salvar a edição: ' + error.message);
    }
  };

  const handleDeleteUser = async (id) => {
    const userParaExcluir = users.find(u => u.id === id);
    if (userParaExcluir && userParaExcluir.email === 'admin@admin.com') {
      alert('Não é possível excluir o administrador padrão!');
      return;
    }
    if (window.confirm('Tem certeza que deseja excluir este usuário?')) {
      try {
        await supabaseRequest('usuarios', 'DELETE', { query: `?id=eq.${id}` });
        setUsers(users.filter(u => u.id !== id));
      } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        alert('Não foi possível excluir o usuário: ' + error.message);
      }
    }
  };

  // Reseta a senha do usuário para o padrão e marca como primeiro acesso,
  // forçando a criação de uma nova senha no próximo login.
  // Executa de fato o reset de senha (chamado a partir do modal de confirmação
  // em tela, sem depender de window.confirm — que se mostrou pouco confiável).
  const handleResetPassword = async () => {
    if (!confirmResetPasswordUser) return;
    setResettingPassword(true);
    try {
      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${confirmResetPasswordUser.id}&select=id,name,email,profile,first_access`,
        body: { password: '123456', first_access: true }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);
      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setConfirmResetPasswordUser(null);
    } catch (error) {
      console.error('Erro ao resetar senha:', error);
      alert('Não foi possível resetar a senha: ' + error.message);
    } finally {
      setResettingPassword(false);
    }
  };

  // Fluxo de registro de ponto com confirmação por mapa
  const [clockModalOpen, setClockModalOpen] = useState(false);
  // status: 'checking-permission' | 'permission-denied' | 'loading-location' | 'geocoding' | 'ready' | 'error'
  const [clockModalStatus, setClockModalStatus] = useState('checking-permission');
  const [clockModalPosition, setClockModalPosition] = useState(null);
  const [clockModalAddress, setClockModalAddress] = useState(null);
  const [clockModalErrorMsg, setClockModalErrorMsg] = useState('');
  const [isConfirmingClockIn, setIsConfirmingClockIn] = useState(false);

  // Ao tocar em "Registrar Ponto": abre o modal e começa o processo de obter
  // a localização. O registro só é efetivado quando o usuário confirmar,
  // depois do mapa ter carregado — nunca automaticamente.
  const handleOpenClockModal = async () => {
    setClockModalOpen(true);
    setClockModalPosition(null);
    setClockModalAddress(null);
    setClockModalErrorMsg('');
    setClockModalStatus('checking-permission');

    if (currentUser) {
      const hoje = new Date();
      const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
      const feriasHoje = getVacationForDate(currentUser.id, hojeStr);
      if (feriasHoje) {
        setClockModalErrorMsg(`Você está de férias até ${formatDate(feriasHoje.endDate)}. Não é possível registrar ponto durante as férias.`);
        setClockModalStatus('ferias');
        return;
      }
    }

    const permissao = await checkGeoPermission();
    if (permissao === 'denied') {
      setClockModalStatus('permission-denied');
      return;
    }

    setClockModalStatus('loading-location');
    const { position, errorReason } = await getCurrentPosition();
    if (!position) {
      setClockModalErrorMsg(errorReason || 'Não foi possível obter sua localização.');
      setClockModalStatus(errorReason === 'Permissão de localização negada' ? 'permission-denied' : 'error');
      return;
    }

    setClockModalPosition(position);
    setClockModalStatus('geocoding');
    const endereco = await reverseGeocode(position.latitude, position.longitude);
    setClockModalAddress(endereco);
    setClockModalStatus('ready');
  };

  const handleCloseClockModal = () => {
    setClockModalOpen(false);
    setClockModalStatus('checking-permission');
    setClockModalPosition(null);
    setClockModalAddress(null);
    setClockModalErrorMsg('');
  };

  // Executa de fato o registro do ponto — só é chamado depois que o usuário
  // confirma no modal, com o mapa já carregado.
  const handleConfirmClockIn = async () => {
    if (!currentUser || !clockModalPosition) return;
    setIsConfirmingClockIn(true);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayRecords = timeRecords.filter(r => 
      r.userId === currentUser.id && r.date === today
    );
    const type = todayRecords.length % 2 === 0 ? 'entrada' : 'saída';

    try {
      const inseridos = await supabaseRequest('registros_ponto', 'POST', {
        body: {
          user_id: currentUser.id,
          user_name: currentUser.name,
          date: today,
          time: now.toTimeString().split(' ')[0],
          datetime: now.toISOString(),
          type,
          latitude: clockModalPosition.latitude,
          longitude: clockModalPosition.longitude,
          address: clockModalAddress,
        }
      });
      const novoRegistro = dbRecordToApp(inseridos[0]);
      setTimeRecords([...timeRecords, novoRegistro]);
      const avisoEndereco = clockModalAddress ? '' : ' (endereço não identificado)';
      setClockMessage({ text: `Ponto registrado: ${type.toUpperCase()} às ${novoRegistro.time}${avisoEndereco}`, error: false });
      handleCloseClockModal();
    } catch (error) {
      console.error('Erro ao salvar registro de ponto:', error);
      setClockMessage({ text: 'Erro ao salvar o ponto: ' + error.message, error: true });
      handleCloseClockModal();
    } finally {
      setIsConfirmingClockIn(false);
    }

    setTimeout(() => setClockMessage(null), 5000);
  };

  // Converte "HH:MM:SS" em minutos desde a meia-noite, para facilitar cálculos
  const timeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 60 + m + (s || 0) / 60;
  };

  // Calcula as métricas de um único dia (entrada, intervalo, saída, horas
  // trabalhadas e horas extras) a partir dos registros de ponto daquele dia.
  //
  // Regras assumidas (combinadas com o usuário):
  // - 2 marcações no dia = entrada + saída, sem intervalo marcado → assume-se
  //   1 hora de intervalo automaticamente.
  // - 4 marcações no dia = entrada, início do intervalo, fim do intervalo, saída.
  // - 1 ou 3 marcações = dia incompleto (falta alguma marcação); não entra no
  //   somatório de horas.
  // - Dia sem nenhuma marcação = não trabalhado; não entra no somatório.
  const JORNADA_DIARIA_HORAS = 8;

  const getDayMetrics = (dateStr, allRecords, atestado = null, feriado = null, ferias = null) => {
    const dayRecords = allRecords
      .filter(r => r.date === dateStr)
      .sort((a, b) => a.time.localeCompare(b.time));

    const punches = dayRecords.map(r => r.time);
    const n = punches.length;

    let entrada = null, inicioIntervalo = null, fimIntervalo = null, saida = null;
    let horasTrabalhadas = null;
    let status = 'sem-registro';

    if (n === 0) {
      status = 'sem-registro';
    } else if (n === 1) {
      entrada = punches[0];
      status = 'incompleto';
    } else if (n === 2) {
      entrada = punches[0];
      saida = punches[1];
      const totalMin = timeToMinutes(saida) - timeToMinutes(entrada) - 60; // assume 1h de intervalo
      horasTrabalhadas = Math.max(0, totalMin) / 60;
      status = 'completo';
    } else if (n === 3) {
      entrada = punches[0];
      inicioIntervalo = punches[1];
      fimIntervalo = punches[2];
      status = 'incompleto'; // falta a marcação de saída
    } else {
      entrada = punches[0];
      inicioIntervalo = punches[1];
      fimIntervalo = punches[2];
      saida = punches[3];
      const minTrabalhados = (timeToMinutes(inicioIntervalo) - timeToMinutes(entrada)) +
                              (timeToMinutes(saida) - timeToMinutes(fimIntervalo));
      horasTrabalhadas = Math.max(0, minTrabalhados) / 60;
      status = 'completo';
    }

    // Regras de atestado médico:
    // - Se há lançamento (2 ou 4 marcações = status "completo"), soma-se as
    //   horas do atestado às horas realmente trabalhadas.
    // - Se não há nenhuma marcação ("sem-registro"), as horas trabalhadas do
    //   dia passam a ser as horas do atestado (cobertura total ou parcial).
    // - Se há apenas 1 ou 3 marcações ("incompleto"), o atestado não altera
    //   nada — o dia continua incompleto por falta de marcação de saída/etc.
    if (atestado) {
      if (status === 'completo') {
        horasTrabalhadas = (horasTrabalhadas || 0) + atestado.hours;
      } else if (status === 'sem-registro') {
        status = 'completo';
        horasTrabalhadas = atestado.hours;
      }
    }

    let horasExtras = horasTrabalhadas !== null ? horasTrabalhadas - JORNADA_DIARIA_HORAS : null;

    // Havendo atestado médico (de qualquer quantidade de horas), a hora extra
    // do dia nunca fica negativa — a ausência parcial está justificada.
    if (atestado && horasExtras !== null) {
      horasExtras = Math.max(0, horasExtras);
    }

    // Nova inconsistência: mesmo com atestado, se o total de horas (lançamento
    // + atestado, ou só atestado quando não há lançamento) ficar abaixo da
    // jornada diária, ainda é uma inconsistência — falta alguma coisa explicar.
    const atestadoInsuficiente = !!(atestado && status === 'completo' && horasTrabalhadas < JORNADA_DIARIA_HORAS);

    const isManuallyAdjusted = dayRecords.some(r => r.manuallyAdjusted);
    const adjustmentReason = dayRecords.find(r => r.adjustmentReason)?.adjustmentReason || null;

    return {
      date: dateStr, entrada, inicioIntervalo, fimIntervalo, saida,
      horasTrabalhadas, horasExtras, status, isManuallyAdjusted, adjustmentReason,
      temAtestado: !!atestado,
      atestadoHoras: atestado ? atestado.hours : null,
      atestadoJustificativa: atestado ? atestado.justification : null,
      atestadoInsuficiente,
      isHoliday: !!feriado,
      holidayDescription: feriado ? feriado.description : null,
      isVacation: !!ferias,
      vacationRange: ferias ? { start: ferias.startDate, end: ferias.endDate } : null,
    };
  };

  const formatHoraCurta = (timeStr) => timeStr ? timeStr.substring(0, 5) : '—';

  const formatHoras = (valor) => {
    if (valor === null || valor === undefined) return '—';
    const sinal = valor < 0 ? '-' : '';
    const abs = Math.abs(valor);
    const h = Math.floor(abs);
    const m = Math.round((abs - h) * 60);
    return `${sinal}${h}h${m.toString().padStart(2, '0')}`;
  };

  // Função para gerar relatório: uma linha para cada dia do mês/ano selecionado
  const generateReportFor = (userId, mesStr, anoStr) => {
    if (!userId || !mesStr || !anoStr) return null;

    const user = users.find(u => u.id === userId);
    const userRecords = timeRecords.filter(r => r.userId === userId);
    const userAtestados = medicalCertificates.filter(a => a.userId === userId);
    const atestadoPorData = Object.fromEntries(userAtestados.map(a => [a.date, a]));
    const feriadoPorData = Object.fromEntries(holidays.map(h => [h.date, h]));

    const ano = parseInt(anoStr);
    const mes = parseInt(mesStr); // 1-12
    const diasNoMes = new Date(ano, mes, 0).getDate();

    const dias = [];
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      dias.push(getDayMetrics(
        dateStr, userRecords,
        atestadoPorData[dateStr] || null,
        feriadoPorData[dateStr] || null,
        getVacationForDate(userId, dateStr)
      ));
    }

    const totalHorasTrabalhadas = dias.reduce((acc, d) => acc + (d.horasTrabalhadas || 0), 0);
    const totalHorasExtras = dias.reduce((acc, d) => acc + (d.horasExtras !== null ? d.horasExtras : 0), 0);

    return { user, dias, totalHorasTrabalhadas, totalHorasExtras };
  };

  const generateReport = () => generateReportFor(reportUser, reportMonth, reportYear);

  // Gera e baixa um PDF do relatório mensal já calculado (report = retorno de generateReport()).
  const handleExportReportPDF = (report, mesStr, anoStr) => {
    const nomesMeses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const nomeMes = nomesMeses[parseInt(mesStr)];

    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('Relatório de Ponto', 14, 18);

    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text(`Funcionário: ${report.user.name}`, 14, 26);
    doc.text(`Período: ${nomeMes} de ${anoStr}`, 14, 32);

    doc.setFont(undefined, 'bold');
    doc.text(`Horas trabalhadas: ${formatHoras(report.totalHorasTrabalhadas)}`, 14, 40);
    doc.text(`Horas extras: ${formatHoras(report.totalHorasExtras)}`, 90, 40);
    doc.setFont(undefined, 'normal');

    const linhas = report.dias.map((dia) => {
      const diaSemana = getDiaSemana(dia.date);
      const observacoes = [];
      if (dia.isManuallyAdjusted) observacoes.push('Ajuste manual');
      if (dia.temAtestado) observacoes.push(`Atestado ${dia.atestadoHoras}h`);
      if (dia.isHoliday) observacoes.push('Feriado');
      if (dia.isVacation) observacoes.push('Férias');
      if (dia.status === 'incompleto') observacoes.push('Incompleto');
      if (isDiaInconsistente(dia, diaSemana)) observacoes.push('Inconsistência');

      return [
        formatDate(dia.date),
        diaSemana.nome,
        formatHoraCurta(dia.entrada),
        formatHoraCurta(dia.inicioIntervalo),
        formatHoraCurta(dia.fimIntervalo),
        formatHoraCurta(dia.saida),
        dia.status === 'incompleto' ? '—' : formatHoras(dia.horasTrabalhadas),
        dia.status === 'incompleto' ? '—' : formatHoras(dia.horasExtras),
        observacoes.join(', '),
      ];
    });

    autoTable(doc, {
      startY: 46,
      head: [['Data', 'Dia', 'Entrada', 'Início Int.', 'Fim Int.', 'Saída', 'Trabalhadas', 'Extras', 'Observações']],
      body: linhas,
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: { 8: { cellWidth: 40 } },
      didParseCell: (data) => {
        // Destaca fins de semana em cinza claro
        if (data.section === 'body') {
          const dateStr = report.dias[data.row.index].date;
          const diaSemana = getDiaSemana(dateStr);
          if (diaSemana.isFimDeSemana) {
            data.cell.styles.fillColor = [245, 245, 245];
            data.cell.styles.textColor = [160, 160, 160];
          }
        }
      },
    });

    const dataGeracao = new Date().toLocaleString('pt-BR');
    const paginaAltura = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Gerado em ${dataGeracao}`, 14, paginaAltura - 10);

    const nomeArquivo = `relatorio-${report.user.name.replace(/\s+/g, '_').toLowerCase()}-${mesStr}-${anoStr}.pdf`;
    doc.save(nomeArquivo);
  };

  // Gera a lista de inconsistências (dias com 1 ou 3 marcações) de um
  // funcionário no mês/ano selecionado, considerando apenas dias já
  // encerrados (anteriores a hoje) — o dia atual, mesmo incompleto até agora,
  // ainda pode receber novas marcações e não é considerado inconsistente.
  const generateInconsistencies = () => {
    if (!inconsistencyUser || !inconsistencyMonth || !inconsistencyYear) return null;

    const user = users.find(u => u.id === inconsistencyUser);
    const userRecords = timeRecords.filter(r => r.userId === inconsistencyUser);
    const userAtestados = medicalCertificates.filter(a => a.userId === inconsistencyUser);
    const atestadoPorData = Object.fromEntries(userAtestados.map(a => [a.date, a]));

    const ano = parseInt(inconsistencyYear);
    const mes = parseInt(inconsistencyMonth);
    const diasNoMes = new Date(ano, mes, 0).getDate();

    const hoje = new Date();
    const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    const inconsistencias = [];
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (dateStr >= hojeStr) continue; // ignora hoje e datas futuras
      if (holidays.some(h => h.date === dateStr)) continue; // dia marcado como feriado — resolvido
      if (isDateInVacation(inconsistencyUser, dateStr)) continue; // dia de férias — não é inconsistência

      const metrics = getDayMetrics(dateStr, userRecords, atestadoPorData[dateStr] || null);
      const diaSemana = getDiaSemana(dateStr);

      if (metrics.status === 'incompleto') {
        const motivo = metrics.saida === null && metrics.fimIntervalo === null
          ? 'Apenas 1 marcação registrada (entrada) — faltam início/fim do intervalo e a saída'
          : '3 marcações registradas (entrada, início e fim do intervalo) — falta a saída';
        inconsistencias.push({ ...metrics, diaSemana, motivo });
      } else if (metrics.atestadoInsuficiente) {
        const motivo = metrics.entrada
          ? `Atestado de ${metrics.atestadoHoras}h somado às marcações totaliza apenas ${formatHoras(metrics.horasTrabalhadas)} — menos que a jornada de ${JORNADA_DIARIA_HORAS}h`
          : `Atestado de ${metrics.atestadoHoras}h não cobre a jornada de ${JORNADA_DIARIA_HORAS}h e não há nenhuma marcação de ponto`;
        inconsistencias.push({ ...metrics, diaSemana, motivo });
      } else if (metrics.status === 'sem-registro' && !diaSemana.isFimDeSemana) {
        inconsistencias.push({ ...metrics, diaSemana, motivo: 'Dia útil sem nenhuma marcação de ponto' });
      }
    }

    return { user, inconsistencias };
  };

  // Abre o modal de ajuste de ponto, pré-preenchendo com o que já existe
  // naquele dia. Pode ser chamado tanto a partir de uma inconsistência
  // quanto de qualquer dia normal na tela de Relatório.
  const openResolveModal = (dia, userId) => {
    setResolveUserId(userId);
    setResolveDate(dia.date);
    setResolveEntrada(dia.entrada ? dia.entrada.substring(0, 5) : '');
    setResolveInicioIntervalo(dia.inicioIntervalo ? dia.inicioIntervalo.substring(0, 5) : '');
    setResolveFimIntervalo(dia.fimIntervalo ? dia.fimIntervalo.substring(0, 5) : '');
    setResolveSaida(dia.saida ? dia.saida.substring(0, 5) : '');
    setResolveTemAtestado(!!dia.temAtestado);
    setResolveAtestadoHoras(dia.atestadoHoras != null ? String(dia.atestadoHoras) : '');
    setResolveEhFeriado(!!dia.isHoliday);
    setResolveJustificativa('');
    setResolveError('');
    setResolveOriginalDia(dia);
    setResolveModalOpen(true);
  };

  const closeResolveModal = () => {
    setResolveModalOpen(false);
    setResolveError('');
    setResolveOriginalDia(null);
  };

  // Salva a correção de horários (e, se marcado, o atestado médico): valida,
  // apaga os lançamentos antigos do dia e insere os novos, marcados como
  // ajuste manual com a justificativa informada.
  const handleSaveHorarios = async () => {
    setResolveError('');

    if (!resolveJustificativa.trim()) {
      setResolveError('Informe a justificativa do ajuste.');
      return;
    }

    if (resolveTemAtestado && (!resolveAtestadoHoras || parseFloat(resolveAtestadoHoras) <= 0)) {
      setResolveError('Informe a quantidade de horas do atestado médico.');
      return;
    }

    const atestadoHorasNum = resolveTemAtestado ? parseFloat(resolveAtestadoHoras) : null;
    const coberturaIntegral = resolveTemAtestado && atestadoHorasNum >= JORNADA_DIARIA_HORAS;

    // Entrada e saída só podem ficar em branco quando o atestado cobre a
    // jornada inteira (dia sem nenhuma marcação, justificado integralmente).
    if (!coberturaIntegral && (!resolveEntrada || !resolveSaida)) {
      setResolveError('Informe entrada e saída (só é possível deixar em branco se o atestado cobrir a jornada inteira de 8h).');
      return;
    }

    // Monta a lista de horários preenchidos, na ordem esperada
    const horarios = [
      ...(resolveEntrada ? [{ label: 'entrada', valor: resolveEntrada }] : []),
      ...(resolveInicioIntervalo ? [{ label: 'início intervalo', valor: resolveInicioIntervalo }] : []),
      ...(resolveFimIntervalo ? [{ label: 'fim intervalo', valor: resolveFimIntervalo }] : []),
      ...(resolveSaida ? [{ label: 'saída', valor: resolveSaida }] : []),
    ];

    if (horarios.length > 0 && (!resolveEntrada || !resolveSaida)) {
      setResolveError('Se informar algum horário, entrada e saída são obrigatórios.');
      return;
    }

    // Valida ordem cronológica estrita entre os horários preenchidos
    for (let i = 0; i < horarios.length - 1; i++) {
      if (horarios[i].valor >= horarios[i + 1].valor) {
        setResolveError(`O horário de "${horarios[i + 1].label}" precisa ser depois do de "${horarios[i].label}".`);
        return;
      }
    }
    // Regra explícita: início/fim de intervalo, se informados, devem ambos estar presentes
    if ((resolveInicioIntervalo && !resolveFimIntervalo) || (!resolveInicioIntervalo && resolveFimIntervalo)) {
      setResolveError('Preencha início E fim do intervalo, ou deixe os dois em branco.');
      return;
    }

    setResolveSaving(true);
    try {
      const usuarioAlvo = users.find(u => u.id === resolveUserId);

      // Remove os lançamentos antigos daquele dia (se houver)
      await supabaseRequest('registros_ponto', 'DELETE', {
        query: `?user_id=eq.${resolveUserId}&date=eq.${resolveDate}`
      });

      let novosRegistros = [];
      if (horarios.length > 0) {
        const linhas = horarios.map((h, idx) => ({
          user_id: resolveUserId,
          user_name: usuarioAlvo.name,
          date: resolveDate,
          time: `${h.valor}:00`,
          datetime: `${resolveDate}T${h.valor}:00`,
          type: idx % 2 === 0 ? 'entrada' : 'saída',
          manually_adjusted: true,
          adjustment_reason: resolveJustificativa.trim(),
        }));
        const inseridos = await supabaseRequest('registros_ponto', 'POST', { body: linhas });
        novosRegistros = inseridos.map(dbRecordToApp);
      }

      // Atualiza o estado local: remove os antigos daquele dia/usuário e adiciona os novos
      setTimeRecords([
        ...timeRecords.filter(r => !(r.userId === resolveUserId && r.date === resolveDate)),
        ...novosRegistros,
      ]);

      // Salva (ou remove) o atestado médico para este dia
      if (resolveTemAtestado) {
        const existente = medicalCertificates.find(a => a.userId === resolveUserId && a.date === resolveDate);
        if (existente) {
          await supabaseRequest('atestados', 'PATCH', {
            query: `?id=eq.${existente.id}`,
            body: { hours: atestadoHorasNum, justification: resolveJustificativa.trim() }
          });
          setMedicalCertificates(medicalCertificates.map(a =>
            a.id === existente.id ? { ...a, hours: atestadoHorasNum, justification: resolveJustificativa.trim() } : a
          ));
        } else {
          const inserido = await supabaseRequest('atestados', 'POST', {
            body: { user_id: resolveUserId, date: resolveDate, hours: atestadoHorasNum, justification: resolveJustificativa.trim() }
          });
          const novo = inserido[0];
          setMedicalCertificates([...medicalCertificates, {
            id: novo.id, userId: novo.user_id, date: novo.date, hours: parseFloat(novo.hours), justification: novo.justification
          }]);
        }
      } else {
        // Se desmarcou o atestado, remove um eventual atestado salvo antes para este dia
        const existente = medicalCertificates.find(a => a.userId === resolveUserId && a.date === resolveDate);
        if (existente) {
          await supabaseRequest('atestados', 'DELETE', { query: `?id=eq.${existente.id}` });
          setMedicalCertificates(medicalCertificates.filter(a => a.id !== existente.id));
        }
      }

      closeResolveModal();
    } catch (error) {
      console.error('Erro ao salvar correção:', error);
      setResolveError('Erro ao salvar: ' + error.message);
    } finally {
      setResolveSaving(false);
    }
  };

  // Marca o dia como feriado: some da lista de inconsistências dali pra frente,
  // e remove eventuais lançamentos equivocados deste funcionário nesse dia.
  const handleMarkHoliday = async () => {
    setResolveError('');

    if (!resolveJustificativa.trim()) {
      setResolveError('Informe a justificativa do ajuste.');
      return;
    }

    setResolveSaving(true);
    try {
      try {
        await supabaseRequest('feriados', 'POST', {
          body: { date: resolveDate, description: resolveJustificativa.trim() },
        });
      } catch (err) {
        // Se já existir (conflito de data única), atualiza a descrição em vez de falhar
        await supabaseRequest('feriados', 'PATCH', {
          query: `?date=eq.${resolveDate}`,
          body: { description: resolveJustificativa.trim() }
        });
      }

      // Remove lançamentos equivocados deste funcionário nesse dia, já que
      // um feriado não deveria ter marcações de ponto.
      await supabaseRequest('registros_ponto', 'DELETE', {
        query: `?user_id=eq.${resolveUserId}&date=eq.${resolveDate}`
      });
      setTimeRecords(timeRecords.filter(r => !(r.userId === resolveUserId && r.date === resolveDate)));

      if (!holidays.some(h => h.date === resolveDate)) {
        setHolidays([...holidays, { date: resolveDate, description: resolveJustificativa.trim() }]);
      } else {
        setHolidays(holidays.map(h => h.date === resolveDate ? { ...h, description: resolveJustificativa.trim() } : h));
      }
      closeResolveModal();
    } catch (error) {
      console.error('Erro ao marcar feriado:', error);
      setResolveError('Erro ao salvar: ' + error.message);
    } finally {
      setResolveSaving(false);
    }
  };

  // Ponto único de salvamento: decide entre marcar feriado ou corrigir
  // horários/atestado, dependendo do checkbox "É feriado".
  const handleSaveAjuste = () => {
    if (resolveEhFeriado) {
      handleMarkHoliday();
    } else {
      handleSaveHorarios();
    }
  };

  // ===== Férias =====
  const [vacationUserId, setVacationUserId] = useState('');
  const [vacationStart, setVacationStart] = useState('');
  const [vacationEnd, setVacationEnd] = useState('');
  const [vacationError, setVacationError] = useState('');
  const [vacationSaving, setVacationSaving] = useState(false);
  const [editingVacationId, setEditingVacationId] = useState(null);
  const [showVacationForm, setShowVacationForm] = useState(false);
  const [vacationSearchQuery, setVacationSearchQuery] = useState('');
  const [vacationStatusFilter, setVacationStatusFilter] = useState('todas'); // 'todas' | 'andamento' | 'agendada' | 'concluida'
  const [vacationMenuOpenId, setVacationMenuOpenId] = useState(null);

  const resetVacationForm = () => {
    setVacationUserId('');
    setVacationStart('');
    setVacationEnd('');
    setVacationError('');
    setEditingVacationId(null);
    setShowVacationForm(false);
  };

  const handleEditVacationClick = (vacation) => {
    setEditingVacationId(vacation.id);
    setVacationUserId(vacation.userId);
    setVacationStart(vacation.startDate);
    setVacationEnd(vacation.endDate);
    setVacationError('');
    setShowVacationForm(true);
  };

  // Calcula o status de um período de férias em relação à data de hoje
  const getVacationStatus = (vacation) => {
    const hoje = new Date();
    const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    if (hojeStr < vacation.startDate) return 'agendada';
    if (hojeStr > vacation.endDate) return 'concluida';
    return 'andamento';
  };

  // Verifica se uma data (string 'YYYY-MM-DD') está dentro de algum período de
  // férias já registrado para o usuário informado.
  const isDateInVacation = (userId, dateStr) => {
    return vacations.some(v => v.userId === userId && dateStr >= v.startDate && dateStr <= v.endDate);
  };

  // Retorna o período de férias (se houver) que cobre a data informada.
  const getVacationForDate = (userId, dateStr) => {
    return vacations.find(v => v.userId === userId && dateStr >= v.startDate && dateStr <= v.endDate) || null;
  };

  const handleSaveVacation = async () => {
    setVacationError('');

    if (!vacationUserId || !vacationStart || !vacationEnd) {
      setVacationError('Selecione o funcionário e as duas datas.');
      return;
    }
    if (vacationEnd < vacationStart) {
      setVacationError('A data de fim não pode ser antes da data de início.');
      return;
    }

    const qtdDias = Math.round((new Date(vacationEnd) - new Date(vacationStart)) / 86400000) + 1;

    if (qtdDias > 30) {
      const confirmar = window.confirm(
        `Este período tem ${qtdDias} dias — mais que os 30 dias padrão de férias. Deseja confirmar mesmo assim?`
      );
      if (!confirmar) return;
    }

    // Verifica se há ponto registrado em algum dia do período (exceto o próprio
    // registro sendo editado, que pode manter seus próprios dias)
    const temPontoNoPeriodo = timeRecords.some(r =>
      r.userId === vacationUserId && r.date >= vacationStart && r.date <= vacationEnd
    );
    if (temPontoNoPeriodo) {
      setVacationError('Já existe ponto registrado em algum dia deste período. Ajuste ou remova esses registros antes de lançar as férias.');
      return;
    }

    setVacationSaving(true);
    try {
      const usuarioAlvo = users.find(u => u.id === vacationUserId);

      if (editingVacationId) {
        await supabaseRequest('ferias', 'PATCH', {
          query: `?id=eq.${editingVacationId}`,
          body: { user_id: vacationUserId, start_date: vacationStart, end_date: vacationEnd }
        });
        setVacations(vacations.map(v => v.id === editingVacationId
          ? { ...v, userId: vacationUserId, userName: usuarioAlvo.name, startDate: vacationStart, endDate: vacationEnd }
          : v
        ));
      } else {
        const inserido = await supabaseRequest('ferias', 'POST', {
          body: { user_id: vacationUserId, start_date: vacationStart, end_date: vacationEnd }
        });
        const novo = inserido[0];
        setVacations([...vacations, {
          id: novo.id, userId: novo.user_id, userName: usuarioAlvo.name, startDate: novo.start_date, endDate: novo.end_date
        }]);
      }
      resetVacationForm();
    } catch (error) {
      console.error('Erro ao salvar férias:', error);
      setVacationError('Erro ao salvar: ' + error.message);
    } finally {
      setVacationSaving(false);
    }
  };

  const handleDeleteVacation = async (vacation) => {
    if (!window.confirm(`Excluir o período de férias de ${vacation.userName} (${formatDate(vacation.startDate)} a ${formatDate(vacation.endDate)})?`)) {
      return;
    }
    try {
      await supabaseRequest('ferias', 'DELETE', { query: `?id=eq.${vacation.id}` });
      setVacations(vacations.filter(v => v.id !== vacation.id));
    } catch (error) {
      console.error('Erro ao excluir férias:', error);
      alert('Não foi possível excluir: ' + error.message);
    }
  };

  // ===== Alertas de horas extras =====
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertUserId, setAlertUserId] = useState('');
  const [alertType, setAlertType] = useState('diario'); // 'diario' | 'semanal' | 'mensal'
  const [alertThreshold, setAlertThreshold] = useState('');
  const [alertError, setAlertError] = useState('');
  const [alertSaving, setAlertSaving] = useState(false);
  const [confirmDeleteAlert, setConfirmDeleteAlert] = useState(null);

  const resetAlertForm = () => {
    setShowAlertForm(false);
    setAlertUserId('');
    setAlertType('diario');
    setAlertThreshold('');
    setAlertError('');
  };

  const handleSaveAlert = async () => {
    setAlertError('');
    if (!alertUserId || !alertThreshold || parseFloat(alertThreshold) <= 0) {
      setAlertError('Selecione o funcionário e informe um limite de horas maior que zero.');
      return;
    }
    setAlertSaving(true);
    try {
      const usuarioAlvo = users.find(u => u.id === alertUserId);
      const inserido = await supabaseRequest('alertas_horas_extras', 'POST', {
        body: { user_id: alertUserId, type: alertType, threshold_hours: parseFloat(alertThreshold) }
      });
      const novo = inserido[0];
      setOvertimeAlerts([...overtimeAlerts, {
        id: novo.id, userId: novo.user_id, userName: usuarioAlvo.name, type: novo.type, thresholdHours: parseFloat(novo.threshold_hours)
      }]);
      resetAlertForm();
    } catch (error) {
      console.error('Erro ao salvar alerta:', error);
      setAlertError('Erro ao salvar: ' + error.message);
    } finally {
      setAlertSaving(false);
    }
  };

  const handleDeleteAlert = async () => {
    if (!confirmDeleteAlert) return;
    try {
      await supabaseRequest('alertas_horas_extras', 'DELETE', { query: `?id=eq.${confirmDeleteAlert.id}` });
      setOvertimeAlerts(overtimeAlerts.filter(a => a.id !== confirmDeleteAlert.id));
      setConfirmDeleteAlert(null);
    } catch (error) {
      console.error('Erro ao excluir alerta:', error);
      alert('Não foi possível excluir: ' + error.message);
    }
  };

  // Soma as horas extras de uma lista de datas para um funcionário, usando as
  // mesmas regras do relatório (atestado, feriado, férias já consideradas).
  const somarHorasExtrasDatas = (userId, datas) => {
    const userRecords = timeRecords.filter(r => r.userId === userId);
    const userAtestados = medicalCertificates.filter(a => a.userId === userId);
    const atestadoPorData = Object.fromEntries(userAtestados.map(a => [a.date, a]));
    const feriadoPorData = Object.fromEntries(holidays.map(h => [h.date, h]));

    return datas.reduce((soma, dateStr) => {
      const metrics = getDayMetrics(
        dateStr, userRecords,
        atestadoPorData[dateStr] || null,
        feriadoPorData[dateStr] || null,
        getVacationForDate(userId, dateStr)
      );
      return soma + (metrics.horasExtras || 0);
    }, 0);
  };

  // Calcula as horas extras acumuladas "até agora" no período do alerta
  // (dia de hoje, semana atual começando na segunda, ou mês atual).
  const getAlertCurrentHours = (alert) => {
    const hoje = new Date();
    const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    if (alert.type === 'diario') {
      return somarHorasExtrasDatas(alert.userId, [hojeStr]);
    }

    if (alert.type === 'semanal') {
      const diaSemanaHoje = hoje.getDay(); // 0 = domingo
      const deslocamentoSegunda = diaSemanaHoje === 0 ? 6 : diaSemanaHoje - 1;
      const datas = [];
      for (let i = 0; i <= deslocamentoSegunda; i++) {
        const d = new Date(hoje);
        d.setDate(hoje.getDate() - deslocamentoSegunda + i);
        datas.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
      return somarHorasExtrasDatas(alert.userId, datas);
    }

    // mensal
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth() + 1;
    const datas = [];
    for (let dia = 1; dia <= hoje.getDate(); dia++) {
      datas.push(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
    }
    return somarHorasExtrasDatas(alert.userId, datas);
  };

  const getAlertsWithStatus = () => {
    return overtimeAlerts.map(alert => {
      const horasAtuais = getAlertCurrentHours(alert);
      return { ...alert, horasAtuais, disparado: horasAtuais >= alert.thresholdHours };
    });
  };

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  // Verifica se um dia (já processado por getDayMetrics) deve ser sinalizado
  // como inconsistência na tabela do relatório — mesma lógica usada na tela
  // de Inconsistências, mas aplicada linha a linha aqui.
  const isDiaInconsistente = (dia, diaSemana) => {
    const hoje = new Date();
    const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    if (dia.date >= hojeStr) return false; // hoje e datas futuras não contam
    if (dia.isHoliday) return false;
    if (dia.isVacation) return false;
    if (dia.status === 'incompleto') return true;
    if (dia.atestadoInsuficiente) return true;
    if (dia.status === 'sem-registro' && !diaSemana.isFimDeSemana) return true;
    return false;
  };

  // Resumo para a tela de Início: total de inconsistências do mês atual
  // (somando todos os funcionários) e quem está de férias hoje.
  // Conta inconsistências por funcionário num mês/ano específicos — reaproveitado
  // pela tela Início (mês atual) e pela tela de Inconsistências (mês selecionado).
  const getInconsistencyCountsByMonth = (mes, ano) => {
    const hoje = new Date();
    const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const funcionarios = users.filter(u => u.profile === 'employee');

    return funcionarios
      .map(func => {
        const userRecords = timeRecords.filter(r => r.userId === func.id);
        const userAtestados = medicalCertificates.filter(a => a.userId === func.id);
        const atestadoPorData = Object.fromEntries(userAtestados.map(a => [a.date, a]));

        let count = 0;
        for (let dia = 1; dia <= diasNoMes; dia++) {
          const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
          if (dateStr >= hojeStr) continue;
          if (holidays.some(h => h.date === dateStr)) continue;
          if (isDateInVacation(func.id, dateStr)) continue;

          const metrics = getDayMetrics(dateStr, userRecords, atestadoPorData[dateStr] || null);
          const diaSemana = getDiaSemana(dateStr);
          if (
            metrics.status === 'incompleto' ||
            metrics.atestadoInsuficiente ||
            (metrics.status === 'sem-registro' && !diaSemana.isFimDeSemana)
          ) {
            count++;
          }
        }
        return { userId: func.id, userName: func.name, count };
      })
      .filter(f => f.count > 0);
  };

  const getHomeSummary = () => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth() + 1;
    const hojeStr = `${ano}-${String(mes).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const funcionarios = users.filter(u => u.profile === 'employee');

    const inconsistenciasPorFuncionario = getInconsistencyCountsByMonth(mes, ano);
    const totalInconsistencias = inconsistenciasPorFuncionario.reduce((acc, f) => acc + f.count, 0);

    const funcionariosDeFerias = funcionarios.filter(func => getVacationForDate(func.id, hojeStr));

    // Férias que começam ou terminam (retorno ao trabalho) nos próximos 7 dias
    const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const seteDias = new Date(hojeZero);
    seteDias.setDate(hojeZero.getDate() + 7);
    const proximasMudancasFerias = [];
    vacations.forEach(v => {
      const inicio = new Date(v.startDate + 'T00:00:00');
      const retorno = new Date(v.endDate + 'T00:00:00');
      retorno.setDate(retorno.getDate() + 1); // dia em que volta ao trabalho

      if (inicio > hojeZero && inicio <= seteDias) {
        proximasMudancasFerias.push({ userName: v.userName, tipo: 'saida', data: inicio });
      }
      if (retorno > hojeZero && retorno <= seteDias) {
        proximasMudancasFerias.push({ userName: v.userName, tipo: 'retorno', data: retorno });
      }
    });
    proximasMudancasFerias.sort((a, b) => a.data - b.data);

    return { totalInconsistencias, inconsistenciasPorFuncionario, funcionariosDeFerias, proximasMudancasFerias, totalFuncionarios: funcionarios.length };
  };

  const NOMES_DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  // Retorna o nome do dia da semana e se é fim de semana, a partir de "YYYY-MM-DD".
  // Usa os componentes da data diretamente (em vez de new Date(dateStr) puro)
  // para evitar problemas de fuso horário que deslocariam o dia da semana.
  const getDiaSemana = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const data = new Date(year, month - 1, day);
    const indice = data.getDay(); // 0 = domingo, 6 = sábado
    return { nome: NOMES_DIAS_SEMANA[indice], isFimDeSemana: indice === 0 || indice === 6 };
  };

  // Renderização da tela de login
  if (showLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
              <div className="flex items-center justify-center mb-2">
                <Clock className="w-12 h-12" />
              </div>
              <h1 className="text-2xl font-bold text-center">Controle de Ponto</h1>
              <p className="text-center text-indigo-100 text-sm mt-1">Sistema de Gestão de Horários</p>
              <p className="text-center text-indigo-200 text-[10px] mt-2 font-mono bg-black/20 rounded px-2 py-0.5 inline-block w-full">
                {APP_VERSION}
              </p>
            </div>
            
            {isLoading ? (
              <div className="p-6 text-center">
                <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3"></div>
                <p className="text-gray-600">Carregando dados...</p>
              </div>
            ) : loadError ? (
              <div className="p-6 text-center">
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-3 text-left">
                  <p className="font-semibold mb-1">Não foi possível carregar os dados</p>
                  <p>{loadError}</p>
                </div>
                <button
                  onClick={loadData}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                >
                  Tentar novamente
                </button>
              </div>
            ) : !showPasswordSetup ? (
              <div className="p-6">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">E-mail</label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => { setLoginEmail(e.target.value); setLoginError(''); }}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="seu@email.com"
                      autoCapitalize="none"
                      autoCorrect="off"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Senha</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => { setLoginPassword(e.target.value); setLoginError(''); }}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="••••••••"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  
                  {loginError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">
                      {loginError}
                    </div>
                  )}
                  
                  <button
                    onClick={handleLogin}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                  >
                    <LogIn className="inline mr-2 w-5 h-5" />
                    Entrar
                  </button>
                </div>
                
                <div className="mt-4 pt-4 border-t border-gray-200 text-center text-xs text-gray-500">
                  <p>Primeiro acesso? Use a senha padrão: <strong>123456</strong></p>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-1">Primeiro Acesso</h2>
                <p className="text-gray-600 text-sm mb-4">Configure sua senha pessoal</p>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Nova Senha</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="Mínimo 4 caracteres"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Confirmar Senha</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="Digite a senha novamente"
                      onKeyPress={(e) => e.key === 'Enter' && handlePasswordSetup()}
                    />
                  </div>
                  
                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">
                      {passwordError}
                    </div>
                  )}
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowPasswordSetup(false);
                        setNewPassword('');
                        setConfirmPassword('');
                        setPasswordError('');
                      }}
                      className="flex-1 bg-gray-200 text-gray-700 py-2.5 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handlePasswordSetup}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Renderização do sistema principal
  return (
    <div className="min-h-screen bg-gray-50 pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 pt-2">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-2 rounded-lg flex-shrink-0">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-2xl font-bold text-gray-900 truncate">Controle de Ponto</h1>
                <p className="text-xs sm:text-sm text-gray-600 truncate">
                  {currentUser?.name} ({currentUser?.profile === 'admin' ? 'Admin' : 'Funcionário'})
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium flex-shrink-0"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">
        
        {/* Tela de Registro de Ponto */}
        {activeView === 'clock' && currentUser?.profile === 'employee' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-5 sm:p-8 text-white text-center">
                <Clock className="w-14 h-14 sm:w-20 sm:h-20 mx-auto mb-3 sm:mb-4" />
                <h2 className="text-2xl sm:text-3xl font-bold mb-2">Registrar Ponto</h2>
                <p className="text-sm sm:text-lg text-indigo-100 capitalize">
                  {new Date().toLocaleDateString('pt-BR', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
                <p className="text-3xl sm:text-4xl font-bold mt-3 sm:mt-4">
                  {new Date().toLocaleTimeString('pt-BR')}
                </p>
              </div>
              
              <div className="p-5 sm:p-8">
                <button
                  onClick={handleOpenClockModal}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-5 sm:py-6 rounded-xl font-bold text-lg sm:text-xl hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                >
                  REGISTRAR PONTO
                </button>
                
                {clockMessage && (
                  <div className={`mt-4 rounded-lg px-4 py-3 text-center font-semibold ${
                    clockMessage.error 
                      ? 'bg-red-50 border border-red-200 text-red-700' 
                      : 'bg-green-50 border border-green-200 text-green-700'
                  }`}>
                    {clockMessage.text}
                  </div>
                )}
                
                <div className="mt-6 sm:mt-8">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4">Registros de Hoje</h3>
                  <div className="space-y-2">
                    {currentUser && timeRecords
                      .filter(r => r.userId === currentUser.id && r.date === new Date().toISOString().split('T')[0])
                      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
                      .map(record => (
                        <div key={record.id} className="p-3 sm:p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${record.type === 'entrada' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span className="font-semibold text-gray-700 capitalize">{record.type}</span>
                            </div>
                            <span className="text-gray-600 font-mono">{record.time}</span>
                          </div>
                          {record.address && (
                            <p className="text-xs text-gray-500 mt-1 pl-6">📍 {record.address}</p>
                          )}
                        </div>
                      ))}
                    {currentUser && timeRecords.filter(r => r.userId === currentUser.id && r.date === new Date().toISOString().split('T')[0]).length === 0 && (
                      <p className="text-gray-500 text-center py-4">Nenhum registro hoje</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tela "Meu Espelho de Ponto" (funcionário vê o próprio relatório) */}
        {activeView === 'myreport' && currentUser?.profile === 'employee' && (() => {
          const nomesMeses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
          const report = generateReportFor(currentUser.id, myReportMonth, myReportYear);
          return (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Meu Espelho de Ponto</h2>

              <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                    <select
                      value={myReportMonth}
                      onChange={(e) => setMyReportMonth(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    >
                      {nomesMeses.slice(1).map((nome, idx) => (
                        <option key={idx} value={String(idx + 1).padStart(2, '0')}>{nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                    <input
                      type="number"
                      value={myReportYear}
                      onChange={(e) => setMyReportYear(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {report && (
                <div>
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-5 text-white mb-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="text-xl font-bold">{nomesMeses[parseInt(myReportMonth)]} de {myReportYear}</h3>
                      <button
                        onClick={() => handleExportReportPDF(report, myReportMonth, myReportYear)}
                        className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 transition-colors px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0"
                      >
                        <Download className="w-4 h-4" />
                        PDF
                      </button>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <div className="flex-1 bg-white/10 rounded-lg p-3">
                        <p className="text-indigo-100 text-xs mb-0.5">Horas trabalhadas</p>
                        <p className="text-2xl font-bold">{formatHoras(report.totalHorasTrabalhadas)}</p>
                      </div>
                      <div className="flex-1 bg-white/10 rounded-lg p-3">
                        <p className="text-indigo-100 text-xs mb-0.5">Horas extras</p>
                        <p className={`text-2xl font-bold ${report.totalHorasExtras < 0 ? 'text-red-200' : 'text-green-200'}`}>
                          {formatHoras(report.totalHorasExtras)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {report.dias.map((dia) => {
                      const diaSemana = getDiaSemana(dia.date);
                      const semNadaEspecial = dia.status === 'sem-registro' && !dia.isHoliday && !dia.isVacation && !dia.temAtestado;

                      if (diaSemana.isFimDeSemana && semNadaEspecial) {
                        return (
                          <div key={dia.date} className="px-4 py-1.5 text-xs text-gray-300 flex items-center justify-between">
                            <span>{diaSemana.nome}, {formatDate(dia.date)}</span>
                            <span>fim de semana</span>
                          </div>
                        );
                      }

                      return (
                        <div key={dia.date} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900">{diaSemana.nome}, {formatDate(dia.date)}</p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {dia.isManuallyAdjusted && (
                                  <span title={dia.adjustmentReason || 'Ajuste manual'}>
                                    <Wrench className="w-4 h-4 text-indigo-500" />
                                  </span>
                                )}
                                {dia.temAtestado && (
                                  <span title={`Atestado médico: ${dia.atestadoHoras}h`}>
                                    <Stethoscope className="w-4 h-4 text-rose-500" />
                                  </span>
                                )}
                                {dia.isHoliday && (
                                  <span title="Feriado">
                                    <PartyPopper className="w-4 h-4 text-amber-500" />
                                  </span>
                                )}
                                {dia.isVacation && (
                                  <span title="Férias">
                                    <Palmtree className="w-4 h-4 text-teal-500" />
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {dia.status !== 'sem-registro' ? (
                            <div className="flex items-center gap-1 text-sm font-mono text-gray-600 mb-3 flex-wrap">
                              <span className="bg-gray-50 px-2 py-1 rounded">{formatHoraCurta(dia.entrada)}</span>
                              {dia.inicioIntervalo && (
                                <>
                                  <span className="text-gray-300">→</span>
                                  <span className="bg-gray-50 px-2 py-1 rounded text-gray-400">
                                    {formatHoraCurta(dia.inicioIntervalo)}–{formatHoraCurta(dia.fimIntervalo)}
                                  </span>
                                </>
                              )}
                              <span className="text-gray-300">→</span>
                              <span className="bg-gray-50 px-2 py-1 rounded">{formatHoraCurta(dia.saida)}</span>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-300 mb-3">
                              {dia.isVacation ? 'Férias' : dia.isHoliday ? 'Feriado' : dia.temAtestado ? 'Atestado médico' : 'Sem marcação'}
                            </p>
                          )}

                          <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-50">
                            <span className="text-gray-500">
                              {dia.status === 'incompleto' ? (
                                <span className="text-amber-600 font-medium">Incompleto</span>
                              ) : (
                                <>Trabalhadas: <strong className="text-gray-700">{formatHoras(dia.horasTrabalhadas)}</strong></>
                              )}
                            </span>
                            {dia.status !== 'incompleto' && dia.horasExtras !== null && (
                              <span className={`font-semibold ${
                                dia.horasExtras < 0 ? 'text-red-600' : dia.horasExtras > 0 ? 'text-green-600' : 'text-gray-400'
                              }`}>
                                {dia.horasExtras > 0 ? '+' : ''}{formatHoras(dia.horasExtras)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Tela de Início */}
        {activeView === 'home' && currentUser?.profile === 'admin' && (() => {
          const resumo = getHomeSummary();
          const hoje = new Date();
          const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
          const alertasDisparados = getAlertsWithStatus().filter(a => a.disparado);

          const Tile = ({ onClick, Icon, iconColor, value, label, alerta, span2 }) => (
            <button
              onClick={onClick}
              className={`text-left rounded-xl p-3.5 border transition-colors ${span2 ? 'col-span-2' : ''} ${
                alerta ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'bg-white border-gray-100 shadow-sm hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-5 h-5 flex-shrink-0 ${alerta ? 'text-red-500' : iconColor}`} />
                {value !== undefined && (
                  <span className={`text-xl font-bold leading-none ${alerta ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
                )}
              </div>
              <p className={`text-xs mt-1 truncate ${alerta ? 'text-red-700 font-medium' : 'text-gray-500'}`}>{label}</p>
            </button>
          );

          return (
            <div>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Olá, {currentUser.name.split(' ')[0]}</h2>
                <p className="text-gray-400 text-sm">{nomesMeses[hoje.getMonth()]}/{hoje.getFullYear()}</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <Tile
                  onClick={() => {
                    const hojeNav = new Date();
                    setInconsistencyMonth(String(hojeNav.getMonth() + 1).padStart(2, '0'));
                    setInconsistencyYear(String(hojeNav.getFullYear()));
                    if (resumo.inconsistenciasPorFuncionario.length > 0) {
                      setInconsistencyUser(resumo.inconsistenciasPorFuncionario[0].userId);
                    }
                    setActiveView('inconsistencies');
                  }}
                  Icon={AlertTriangle}
                  iconColor="text-green-500"
                  value={resumo.totalInconsistencias}
                  label="Inconsistências"
                  alerta={resumo.totalInconsistencias > 0}
                />
                <Tile
                  onClick={() => setActiveView('vacations')}
                  Icon={Palmtree}
                  iconColor="text-teal-500"
                  value={resumo.funcionariosDeFerias.length}
                  label={resumo.funcionariosDeFerias.length > 0 ? resumo.funcionariosDeFerias.map(f => f.name).join(', ') : 'De férias agora'}
                />
                <Tile
                  onClick={() => setActiveView('alerts')}
                  Icon={AlertTriangle}
                  iconColor="text-gray-400"
                  value={alertasDisparados.length}
                  label="Alertas de hora extra"
                  alerta={alertasDisparados.length > 0}
                />
                <Tile
                  onClick={() => setActiveView('users')}
                  Icon={Users}
                  iconColor="text-blue-600"
                  value={resumo.totalFuncionarios}
                  label="Funcionários"
                />
                <Tile
                  onClick={() => setActiveView('vacations')}
                  Icon={CalendarClock}
                  iconColor={resumo.proximasMudancasFerias.length > 0 ? 'text-amber-500' : 'text-gray-400'}
                  value={resumo.proximasMudancasFerias.length}
                  label={
                    resumo.proximasMudancasFerias.length > 0
                      ? resumo.proximasMudancasFerias
                          .map(e => `${e.userName} ${e.tipo === 'saida' ? 'sai' : 'volta'} dia ${e.data.getDate()}`)
                          .join(', ')
                      : 'Sem mudanças de férias na semana'
                  }
                  span2
                />
              </div>
            </div>
          );
        })()}

        {/* Tela de Gerenciamento de Usuários */}
        {activeView === 'users' && currentUser?.profile === 'admin' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Usuários</h2>
              <button
                onClick={() => setShowUserForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <Plus className="w-5 h-5" />
                Novo
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Baixar backup (.json)
              </button>
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer">
                <Save className="w-4 h-4" />
                Importar backup
                <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
              </label>
            </div>

            <div className="relative mb-4">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
              />
            </div>

            <div className="space-y-2">
              {users
                .filter(u =>
                  u.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                  u.email.toLowerCase().includes(userSearchQuery.toLowerCase())
                )
                .map(user => (
                  <div key={user.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-3 relative">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 ${
                      user.profile === 'admin' ? 'bg-purple-500' : 'bg-blue-500'
                    }`}>
                      {user.name.trim().charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 truncate">{user.name}</p>
                      <p className="text-sm text-gray-500 truncate">{user.email}</p>
                      <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        user.profile === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {user.profile === 'admin' ? 'Administrador' : 'Funcionário'}
                      </span>
                    </div>

                    <button
                      onClick={() => setUserMenuOpenId(userMenuOpenId === user.id ? null : user.id)}
                      className="p-2.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                      title="Mais opções"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                        <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
                      </svg>
                    </button>

                    {userMenuOpenId === user.id && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpenId(null)}></div>
                        <div className="absolute right-4 top-14 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 w-48 z-40">
                          <button
                            onClick={() => { handleEditUser(user); setUserMenuOpenId(null); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Edit2 className="w-4 h-4 text-blue-600" />
                            Editar dados
                          </button>
                          <button
                            onClick={() => { setConfirmResetPasswordUser(user); setUserMenuOpenId(null); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Wrench className="w-4 h-4 text-amber-600" />
                            Resetar senha
                          </button>
                          <div className="border-t border-gray-100 my-1"></div>
                          <button
                            onClick={() => { setUserMenuOpenId(null); handleDeleteUser(user.id); }}
                            disabled={user.email === 'admin@admin.com'}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                          >
                            <Trash2 className="w-4 h-4" />
                            Excluir
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}

              {users.filter(u =>
                u.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                u.email.toLowerCase().includes(userSearchQuery.toLowerCase())
              ).length === 0 && (
                <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
                  Nenhum usuário encontrado
                </div>
              )}
            </div>

            {/* Modal de cadastro/edição de usuário */}
            {(showUserForm || editingUser) && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900">
                      {editingUser ? 'Editar Usuário' : 'Cadastrar Novo Usuário'}
                    </h3>
                    <button
                      onClick={() => { setShowUserForm(false); setEditingUser(null); setNewUser({ name: '', email: '', profile: 'employee' }); }}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
                      <input
                        type="text"
                        value={editingUser ? editingUser.name : newUser.name}
                        onChange={(e) => editingUser
                          ? setEditingUser({ ...editingUser, name: e.target.value })
                          : setNewUser({ ...newUser, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        placeholder="Nome completo"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">E-mail</label>
                      <input
                        type="email"
                        value={editingUser ? editingUser.email : newUser.email}
                        onChange={(e) => editingUser
                          ? setEditingUser({ ...editingUser, email: e.target.value })
                          : setNewUser({ ...newUser, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        placeholder="email@exemplo.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                      <select
                        value={editingUser ? editingUser.profile : newUser.profile}
                        onChange={(e) => editingUser
                          ? setEditingUser({ ...editingUser, profile: e.target.value })
                          : setNewUser({ ...newUser, profile: e.target.value })}
                        disabled={editingUser && editingUser.email === 'admin@admin.com'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="employee">Funcionário</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={() => { setShowUserForm(false); setEditingUser(null); setNewUser({ name: '', email: '', profile: 'employee' }); }}
                        className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={editingUser ? handleSaveEdit : handleAddUser}
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all"
                      >
                        {editingUser ? 'Salvar alterações' : 'Cadastrar'}
                      </button>
                    </div>
                    {!editingUser && (
                      <p className="text-xs text-gray-400 text-center">
                        A pessoa entra pela primeira vez com a senha padrão 123456 e cria a senha dela.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tela de Relatórios */}
        {activeView === 'report' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Relatório de Ponto</h2>
            
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Gerar Relatório</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                  <select
                    value={reportUser}
                    onChange={(e) => setReportUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {users.filter(u => u.profile === 'employee').map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                  <select
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                  <input
                    type="number"
                    value={reportYear}
                    onChange={(e) => setReportYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2026"
                  />
                </div>
              </div>
            </div>

            {!reportUser ? (
              <div className="bg-white rounded-xl shadow-lg p-8 text-center text-gray-500">
                Selecione um funcionário para gerar o relatório.
              </div>
            ) : (() => {
              const report = generateReport();
              if (!report) return null;
              const nomesMeses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
              return (
                <div>
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-5 text-white mb-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="text-xl font-bold">{report.user.name}</h3>
                      <button
                        onClick={() => handleExportReportPDF(report, reportMonth, reportYear)}
                        className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 transition-colors px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0"
                      >
                        <Download className="w-4 h-4" />
                        PDF
                      </button>
                    </div>
                    <p className="text-indigo-100 text-sm mb-4">
                      {nomesMeses[parseInt(reportMonth)]} de {reportYear}
                    </p>
                    <div className="flex gap-3">
                      <div className="flex-1 bg-white/10 rounded-lg p-3">
                        <p className="text-indigo-100 text-xs mb-0.5">Horas trabalhadas</p>
                        <p className="text-2xl font-bold">{formatHoras(report.totalHorasTrabalhadas)}</p>
                      </div>
                      <div className="flex-1 bg-white/10 rounded-lg p-3">
                        <p className="text-indigo-100 text-xs mb-0.5">Horas extras</p>
                        <p className={`text-2xl font-bold ${report.totalHorasExtras < 0 ? 'text-red-200' : 'text-green-200'}`}>
                          {formatHoras(report.totalHorasExtras)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {report.dias.map((dia) => {
                      const diaSemana = getDiaSemana(dia.date);
                      const inconsistente = isDiaInconsistente(dia, diaSemana);
                      const semNadaEspecial = dia.status === 'sem-registro' && !dia.isHoliday && !dia.isVacation && !dia.temAtestado;

                      // Fim de semana comum, sem nenhum registro ou marcação especial:
                      // vira uma linha fina, pra não poluir a tela com ~9 dias vazios por mês.
                      if (diaSemana.isFimDeSemana && semNadaEspecial) {
                        return (
                          <div
                            key={dia.date}
                            onClick={() => openResolveModal(dia, reportUser)}
                            className="px-4 py-1.5 text-xs text-gray-300 flex items-center justify-between cursor-pointer active:text-gray-400"
                          >
                            <span>{diaSemana.nome}, {formatDate(dia.date)}</span>
                            <span>fim de semana</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={dia.date}
                          onClick={() => openResolveModal(dia, reportUser)}
                          className={`bg-white rounded-xl shadow-sm border p-4 cursor-pointer active:bg-gray-50 transition-colors ${
                            inconsistente ? 'border-red-200' : 'border-gray-100'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900">
                                {diaSemana.nome}, {formatDate(dia.date)}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {dia.isManuallyAdjusted && (
                                  <span title={dia.adjustmentReason || 'Ajuste manual'}>
                                    <Wrench className="w-4 h-4 text-indigo-500" />
                                  </span>
                                )}
                                {dia.temAtestado && (
                                  <span title={`Atestado médico: ${dia.atestadoHoras}h — ${dia.atestadoJustificativa || ''}`}>
                                    <Stethoscope className="w-4 h-4 text-rose-500" />
                                  </span>
                                )}
                                {dia.isHoliday && (
                                  <span title={`Feriado: ${dia.holidayDescription || ''}`}>
                                    <PartyPopper className="w-4 h-4 text-amber-500" />
                                  </span>
                                )}
                                {dia.isVacation && (
                                  <span title={`Férias: ${formatDate(dia.vacationRange.start)} a ${formatDate(dia.vacationRange.end)}`}>
                                    <Palmtree className="w-4 h-4 text-teal-500" />
                                  </span>
                                )}
                                {inconsistente && (
                                  <span title="Inconsistência">
                                    <AlertTriangle className="w-4 h-4 text-red-500" />
                                  </span>
                                )}
                              </div>
                            </div>
                            <Edit2 className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                          </div>

                          {dia.status !== 'sem-registro' ? (
                            <div className="flex items-center gap-1 text-sm font-mono text-gray-600 mb-3 flex-wrap">
                              <span className="bg-gray-50 px-2 py-1 rounded">{formatHoraCurta(dia.entrada)}</span>
                              {dia.inicioIntervalo && (
                                <>
                                  <span className="text-gray-300">→</span>
                                  <span className="bg-gray-50 px-2 py-1 rounded text-gray-400">
                                    {formatHoraCurta(dia.inicioIntervalo)}–{formatHoraCurta(dia.fimIntervalo)}
                                  </span>
                                </>
                              )}
                              <span className="text-gray-300">→</span>
                              <span className="bg-gray-50 px-2 py-1 rounded">{formatHoraCurta(dia.saida)}</span>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-300 mb-3">
                              {dia.isVacation ? 'Férias' : dia.isHoliday ? 'Feriado' : dia.temAtestado ? 'Atestado médico' : 'Sem marcação'}
                            </p>
                          )}

                          <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-50">
                            <span className="text-gray-500">
                              {dia.status === 'incompleto' ? (
                                <span className="text-amber-600 font-medium">Incompleto</span>
                              ) : (
                                <>Trabalhadas: <strong className="text-gray-700">{formatHoras(dia.horasTrabalhadas)}</strong></>
                              )}
                            </span>
                            {dia.status !== 'incompleto' && dia.horasExtras !== null && (
                              <span className={`font-semibold ${
                                dia.horasExtras < 0 ? 'text-red-600' : dia.horasExtras > 0 ? 'text-green-600' : 'text-gray-400'
                              }`}>
                                {dia.horasExtras > 0 ? '+' : ''}{formatHoras(dia.horasExtras)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-xs text-gray-400 text-center mt-4 px-4">
                    Dias com 2 marcações consideram 1h de intervalo automática. Dias com 1 ou 3 marcações ficam "incompletos" e não entram no total. Toque em qualquer dia para ajustar.
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {/* Tela de Inconsistências */}
        {activeView === 'inconsistencies' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Inconsistências</h2>

            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Buscar Inconsistências</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                  <select
                    value={inconsistencyUser}
                    onChange={(e) => setInconsistencyUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {users.filter(u => u.profile === 'employee').map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                  <select
                    value={inconsistencyMonth}
                    onChange={(e) => setInconsistencyMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                  <input
                    type="number"
                    value={inconsistencyYear}
                    onChange={(e) => setInconsistencyYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2026"
                  />
                </div>
              </div>
            </div>

            {!inconsistencyUser ? (() => {
              const afetados = getInconsistencyCountsByMonth(parseInt(inconsistencyMonth), parseInt(inconsistencyYear));
              return (
                <div className="bg-white rounded-xl shadow-lg p-6">
                  {afetados.length === 0 ? (
                    <p className="text-center text-gray-500 py-2">
                      ✅ Nenhuma inconsistência neste mês. Selecione um funcionário acima para conferir mesmo assim.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500 mb-3">Funcionários com inconsistências neste mês:</p>
                      <div className="space-y-2">
                        {afetados.map(f => (
                          <button
                            key={f.userId}
                            onClick={() => setInconsistencyUser(f.userId)}
                            className="w-full flex items-center justify-between bg-red-50 border border-red-200 hover:bg-red-100 transition-colors rounded-lg px-4 py-3 text-left"
                          >
                            <span className="font-medium text-gray-900">{f.userName}</span>
                            <span className="text-red-600 text-sm font-semibold">{f.count} {f.count > 1 ? 'inconsistências' : 'inconsistência'}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })() : (() => {
              const resultado = generateInconsistencies();
              if (!resultado) return null;
              const nomesMeses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
              return (
                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
                    <h3 className="text-2xl font-bold mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-6 h-6" />
                      Inconsistências Encontradas
                    </h3>
                    <p className="text-lg">Funcionário: {resultado.user.name}</p>
                    <p className="text-amber-100">
                      Período: {nomesMeses[parseInt(inconsistencyMonth)]} de {inconsistencyYear}
                    </p>
                  </div>

                  <div className="p-6">
                    {resultado.inconsistencias.length === 0 ? (
                      <p className="text-center text-gray-500 py-8">
                        ✅ Nenhuma inconsistência encontrada neste período.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {resultado.inconsistencias.map((inc) => (
                          <div key={inc.date} className="border border-amber-200 bg-amber-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-gray-900">
                                {formatDate(inc.date)} — {inc.diaSemana.nome}
                              </h4>
                              <button
                                onClick={() => openResolveModal(inc, inconsistencyUser)}
                                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0"
                              >
                                Corrigir
                              </button>
                            </div>
                            <p className="text-sm text-amber-800 mb-2">{inc.motivo}</p>
                            <div className="flex flex-wrap gap-3 text-xs text-gray-600 font-mono">
                              <span>Entrada: {formatHoraCurta(inc.entrada)}</span>
                              <span>Início intervalo: {formatHoraCurta(inc.inicioIntervalo)}</span>
                              <span>Fim intervalo: {formatHoraCurta(inc.fimIntervalo)}</span>
                              <span>Saída: {formatHoraCurta(inc.saida)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Tela de Férias */}
        {activeView === 'vacations' && currentUser?.profile === 'admin' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Férias</h2>
              <button
                onClick={() => setShowVacationForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <Plus className="w-5 h-5" />
                Novo
              </button>
            </div>

            <div className="relative mb-3">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={vacationSearchQuery}
                onChange={(e) => setVacationSearchQuery(e.target.value)}
                placeholder="Buscar por funcionário..."
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { value: 'todas', label: 'Todas' },
                { value: 'andamento', label: '🟢 Em andamento' },
                { value: 'agendada', label: '🔵 Agendadas' },
                { value: 'concluida', label: '⚪ Concluídas' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setVacationStatusFilter(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium text-center transition-colors ${
                    vacationStatusFilter === opt.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {vacations
                .filter(v => (v.userName || '').toLowerCase().includes(vacationSearchQuery.toLowerCase()))
                .filter(v => vacationStatusFilter === 'todas' || getVacationStatus(v) === vacationStatusFilter)
                .sort((a, b) => b.startDate.localeCompare(a.startDate))
                .map(vacation => {
                  const qtdDias = Math.round((new Date(vacation.endDate) - new Date(vacation.startDate)) / 86400000) + 1;
                  const status = getVacationStatus(vacation);
                  const statusInfo = {
                    andamento: { label: 'Em andamento', className: 'bg-green-100 text-green-700' },
                    agendada: { label: 'Agendada', className: 'bg-blue-100 text-blue-700' },
                    concluida: { label: 'Concluída', className: 'bg-gray-100 text-gray-600' },
                  }[status];

                  return (
                    <div key={vacation.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-3 relative">
                      <div className="w-11 h-11 rounded-full bg-teal-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                        {(vacation.userName || '?').trim().charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 truncate">{vacation.userName}</p>
                        <p className="text-sm text-gray-500">
                          {formatDate(vacation.startDate)} — {formatDate(vacation.endDate)}
                          <span className="text-gray-400"> · {qtdDias} {qtdDias === 1 ? 'dia' : 'dias'}</span>
                        </p>
                        <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                      </div>

                      <button
                        onClick={() => setVacationMenuOpenId(vacationMenuOpenId === vacation.id ? null : vacation.id)}
                        className="p-2.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                        title="Mais opções"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                          <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
                        </svg>
                      </button>

                      {vacationMenuOpenId === vacation.id && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setVacationMenuOpenId(null)}></div>
                          <div className="absolute right-4 top-14 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 w-44 z-40">
                            <button
                              onClick={() => { handleEditVacationClick(vacation); setVacationMenuOpenId(null); }}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              <Edit2 className="w-4 h-4 text-blue-600" />
                              Editar
                            </button>
                            <div className="border-t border-gray-100 my-1"></div>
                            <button
                              onClick={() => { setVacationMenuOpenId(null); handleDeleteVacation(vacation); }}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                              Excluir
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

              {vacations
                .filter(v => (v.userName || '').toLowerCase().includes(vacationSearchQuery.toLowerCase()))
                .filter(v => vacationStatusFilter === 'todas' || getVacationStatus(v) === vacationStatusFilter)
                .length === 0 && (
                <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
                  {vacations.length === 0 ? 'Nenhum período de férias registrado' : 'Nenhum resultado para esse filtro'}
                </div>
              )}
            </div>

            {/* Modal de cadastro/edição de férias */}
            {showVacationForm && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900">
                      {editingVacationId ? 'Editar período de férias' : 'Registrar novas férias'}
                    </h3>
                    <button onClick={resetVacationForm} className="p-1 text-gray-400 hover:text-gray-600">
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                      {editingVacationId ? (
                        <div className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600">
                          {users.find(u => u.id === vacationUserId)?.name || '—'}
                          <span className="block text-xs text-gray-400 mt-0.5">
                            Para trocar o funcionário, exclua este período e registre um novo.
                          </span>
                        </div>
                      ) : (
                        <select
                          value={vacationUserId}
                          onChange={(e) => setVacationUserId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Selecione...</option>
                          {users.filter(u => u.profile === 'employee').map(user => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Início</label>
                        <input
                          type="date"
                          value={vacationStart}
                          onChange={(e) => setVacationStart(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Fim</label>
                        <input
                          type="date"
                          value={vacationEnd}
                          onChange={(e) => setVacationEnd(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {vacationError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                        {vacationError}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={resetVacationForm}
                        className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleSaveVacation}
                        disabled={vacationSaving}
                        className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50"
                      >
                        {vacationSaving ? 'Salvando...' : editingVacationId ? 'Salvar alterações' : 'Registrar férias'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tela de Alertas de Horas Extras */}
        {activeView === 'alerts' && currentUser?.profile === 'admin' && (() => {
          const alertasComStatus = getAlertsWithStatus();
          const labelTipo = { diario: 'Diário', semanal: 'Semanal', mensal: 'Mensal' };
          return (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Alertas de Horas Extras</h2>
                <button
                  onClick={() => setShowAlertForm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                >
                  <Plus className="w-5 h-5" />
                  Novo
                </button>
              </div>

              <div className="space-y-2">
                {alertasComStatus.map(alert => (
                  <div
                    key={alert.id}
                    className={`bg-white rounded-xl shadow-sm border p-4 flex items-center gap-3 ${
                      alert.disparado ? 'border-red-200' : 'border-gray-100'
                    }`}
                  >
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
                      alert.disparado ? 'bg-red-100' : 'bg-gray-100'
                    }`}>
                      <AlertTriangle className={`w-5 h-5 ${alert.disparado ? 'text-red-500' : 'text-gray-400'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 truncate">{alert.userName}</p>
                      <p className="text-sm text-gray-500">
                        {labelTipo[alert.type]} · limite {formatHoras(alert.thresholdHours)}
                      </p>
                      <p className={`text-sm font-semibold mt-0.5 ${alert.disparado ? 'text-red-600' : 'text-gray-400'}`}>
                        {alert.disparado ? '⚠️ ' : ''}{formatHoras(alert.horasAtuais)} acumuladas
                      </p>
                    </div>
                    <button
                      onClick={() => setConfirmDeleteAlert(alert)}
                      className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                      title="Excluir alerta"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}

                {alertasComStatus.length === 0 && (
                  <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
                    Nenhum alerta configurado
                  </div>
                )}
              </div>

              {/* Modal de novo alerta */}
              {showAlertForm && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                  <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-bold text-gray-900">Novo alerta de horas extras</h3>
                      <button onClick={resetAlertForm} className="p-1 text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                        <select
                          value={alertUserId}
                          onChange={(e) => setAlertUserId(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Selecione...</option>
                          {users.filter(u => u.profile === 'employee').map(user => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Frequência</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { value: 'diario', label: 'Diário' },
                            { value: 'semanal', label: 'Semanal' },
                            { value: 'mensal', label: 'Mensal' },
                          ].map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setAlertType(opt.value)}
                              className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                                alertType === opt.value
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          A partir de quantas horas extras avisar
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={alertThreshold}
                          onChange={(e) => setAlertThreshold(e.target.value)}
                          placeholder="Ex: 2"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      {alertError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                          {alertError}
                        </div>
                      )}

                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={resetAlertForm}
                          className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleSaveAlert}
                          disabled={alertSaving}
                          className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50"
                        >
                          {alertSaving ? 'Salvando...' : 'Criar alerta'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal de confirmação de exclusão */}
              {confirmDeleteAlert && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                  <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm">
                    <div className="p-6 text-center">
                      <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Trash2 className="w-7 h-7 text-red-600" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-2">Excluir alerta?</h3>
                      <p className="text-gray-500 text-sm mb-6">
                        Alerta {labelTipo[confirmDeleteAlert.type]} de <strong>{confirmDeleteAlert.userName}</strong> (limite {formatHoras(confirmDeleteAlert.thresholdHours)})
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setConfirmDeleteAlert(null)}
                          className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleDeleteAlert}
                          className="flex-1 bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition-all"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      </main>

      {/* Barra de navegação inferior (admin) */}
      {currentUser?.profile === 'admin' && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-7xl mx-auto grid grid-cols-5">
            {[
              { view: 'home', label: 'Início', Icon: Home },
              { view: 'users', label: 'Usuários', Icon: Users },
              { view: 'report', label: 'Relatórios', Icon: FileText },
              { view: 'inconsistencies', label: 'Inconsist.', Icon: AlertTriangle },
              { view: 'vacations', label: 'Férias', Icon: Palmtree },
            ].map(({ view, label, Icon }) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                  activeView === view ? 'text-indigo-600' : 'text-gray-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Barra de navegação inferior (funcionário) */}
      {currentUser?.profile === 'employee' && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-7xl mx-auto grid grid-cols-2">
            {[
              { view: 'clock', label: 'Registrar Ponto', Icon: Clock },
              { view: 'myreport', label: 'Meu Espelho', Icon: FileText },
            ].map(({ view, label, Icon }) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                  activeView === view ? 'text-indigo-600' : 'text-gray-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Modal de confirmação de reset de senha */}
      {confirmResetPasswordUser && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm">
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wrench className="w-7 h-7 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Resetar senha?</h3>
              <p className="text-gray-500 text-sm mb-6">
                A senha de <strong>{confirmResetPasswordUser.name}</strong> volta para o padrão <strong>123456</strong>.
                A pessoa vai precisar criar uma nova senha no próximo login.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmResetPasswordUser(null)}
                  className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={resettingPassword}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50"
                >
                  {resettingPassword ? 'Resetando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de ajuste/resolução de ponto */}
      {resolveModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">
                Ajustar {formatDate(resolveDate)}
              </h3>
              <button onClick={closeResolveModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {resolveOriginalDia && (
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-xs text-gray-500">
                  <strong className="text-gray-600">Atualmente: </strong>
                  {resolveOriginalDia.isHoliday
                    ? 'Feriado registrado'
                    : resolveOriginalDia.isVacation
                      ? 'Período de férias'
                      : resolveOriginalDia.status === 'sem-registro'
                        ? 'Nenhuma marcação registrada'
                        : resolveOriginalDia.status === 'incompleto'
                          ? 'Marcação incompleta (falta horário)'
                          : `Entrada ${formatHoraCurta(resolveOriginalDia.entrada)}, Saída ${formatHoraCurta(resolveOriginalDia.saida)} · ${formatHoras(resolveOriginalDia.horasTrabalhadas)} trabalhadas`}
                  {resolveOriginalDia.temAtestado && ` · Atestado de ${resolveOriginalDia.atestadoHoras}h`}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setResolveEhFeriado(!resolveEhFeriado); setResolveTemAtestado(false); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    resolveEhFeriado
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <PartyPopper className="w-4 h-4" />
                  Feriado
                </button>
                <button
                  type="button"
                  disabled={resolveEhFeriado}
                  onClick={() => setResolveTemAtestado(!resolveTemAtestado)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-30 ${
                    resolveTemAtestado
                      ? 'bg-rose-500 text-white border-rose-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Stethoscope className="w-4 h-4" />
                  Atestado
                </button>
              </div>

              {resolveEhFeriado ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                  Marcar este dia como feriado remove qualquer lançamento deste funcionário na data e impede que ela volte a aparecer como inconsistência.
                </div>
              ) : (
                <>
                  {resolveTemAtestado && (
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                      <label className="block text-sm font-medium text-rose-800 mb-1">Quantidade de horas do atestado</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="24"
                        value={resolveAtestadoHoras}
                        onChange={(e) => setResolveAtestadoHoras(e.target.value)}
                        placeholder="Ex: 4"
                        className="w-full px-3 py-2 border border-rose-200 rounded-lg focus:border-rose-400 focus:outline-none bg-white"
                      />
                      <p className="text-xs text-rose-600 mt-1">
                        Com atestado, a hora extra do dia nunca fica negativa. Com {JORNADA_DIARIA_HORAS}h de atestado, entrada/saída ficam opcionais.
                      </p>
                    </div>
                  )}

                  {/* Linha do tempo do dia, na ordem cronológica: Entrada → Início → Fim → Saída */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                      <label className="flex-1 text-sm font-medium text-gray-700">Entrada</label>
                      <input
                        type="time"
                        value={resolveEntrada}
                        onChange={(e) => setResolveEntrada(e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
                      />
                    </div>
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                      <label className="flex-1 text-sm font-medium text-gray-700">Início intervalo</label>
                      <input
                        type="time"
                        value={resolveInicioIntervalo}
                        onChange={(e) => setResolveInicioIntervalo(e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
                      />
                    </div>
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                      <label className="flex-1 text-sm font-medium text-gray-700">Fim intervalo</label>
                      <input
                        type="time"
                        value={resolveFimIntervalo}
                        onChange={(e) => setResolveFimIntervalo(e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
                      />
                    </div>
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>
                      <label className="flex-1 text-sm font-medium text-gray-700">Saída</label>
                      <input
                        type="time"
                        value={resolveSaida}
                        onChange={(e) => setResolveSaida(e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Entrada e Saída são obrigatórios{resolveTemAtestado ? ` (exceto com ${JORNADA_DIARIA_HORAS}h de atestado)` : ''}. Intervalo é opcional, mas se preencher um lado, precisa preencher o outro.
                  </p>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Justificativa *</label>
                <textarea
                  value={resolveJustificativa}
                  onChange={(e) => setResolveJustificativa(e.target.value)}
                  placeholder={resolveEhFeriado ? 'Ex: Feriado municipal' : 'Explique o motivo deste ajuste'}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none resize-none"
                />
              </div>

              {resolveError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {resolveError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={closeResolveModal}
                  className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveAjuste}
                  disabled={resolveSaving}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50"
                >
                  {resolveSaving ? 'Salvando...' : resolveEhFeriado ? 'Confirmar feriado' : 'Salvar correção'}
                </button>
              </div>
              {!resolveEhFeriado && (
                <p className="text-xs text-gray-400 text-center">
                  Isso substitui todos os lançamentos deste dia e marca como ajuste manual.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação de ponto com mapa (somente visualização) */}
      {clockModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-indigo-600" />
                Confirmar Registro de Ponto
              </h3>
              <button onClick={handleCloseClockModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5">
              {clockModalStatus === 'ferias' && (
                <div className="py-6 text-center">
                  <Palmtree className="w-14 h-14 text-teal-500 mx-auto mb-4" />
                  <p className="font-semibold text-gray-800 mb-1">Você está de férias</p>
                  <p className="text-gray-500 text-sm mb-4">{clockModalErrorMsg}</p>
                  <button
                    onClick={handleCloseClockModal}
                    className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                  >
                    Entendi
                  </button>
                </div>
              )}

              {(clockModalStatus === 'checking-permission' || clockModalStatus === 'loading-location') && (
                <div className="py-12 text-center">
                  <div className="inline-block w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-600 font-medium">
                    {clockModalStatus === 'checking-permission' ? 'Verificando permissão de localização...' : 'Obtendo sua localização...'}
                  </p>
                  <p className="text-gray-400 text-sm mt-1">Isso pode levar alguns segundos</p>
                </div>
              )}

              {clockModalStatus === 'permission-denied' && (
                <div className="py-6">
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-800">Permissão de localização bloqueada</p>
                        <p className="text-amber-700 text-sm mt-1">
                          O registro de ponto exige acesso à sua localização. Seu navegador ou celular está bloqueando esse acesso.
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm font-medium mb-2">Como permitir:</p>
                  <ul className="text-gray-600 text-sm space-y-1.5 list-disc pl-5 mb-4">
                    <li><strong>iPhone:</strong> Ajustes → Privacidade e Segurança → Serviços de Localização → seu navegador → "Perguntar" ou "Sempre"</li>
                    <li><strong>Android:</strong> Configurações → Apps → seu navegador → Permissões → Localização → Permitir</li>
                    <li>Depois, atualize a página e tente registrar o ponto de novo</li>
                  </ul>
                  <button
                    onClick={handleOpenClockModal}
                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {clockModalStatus === 'error' && (
                <div className="py-6">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p className="font-semibold text-red-700">Não foi possível obter sua localização</p>
                    <p className="text-red-600 text-sm mt-1">{clockModalErrorMsg}</p>
                  </div>
                  <button
                    onClick={handleOpenClockModal}
                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {(clockModalStatus === 'geocoding' || clockModalStatus === 'ready') && clockModalPosition && (
                <div>
                  <div className="rounded-xl overflow-hidden border border-gray-200 mb-4" style={{ height: '260px' }}>
                    <MapContainer
                      center={[clockModalPosition.latitude, clockModalPosition.longitude]}
                      zoom={17}
                      style={{ height: '100%', width: '100%' }}
                      dragging={false}
                      zoomControl={false}
                      scrollWheelZoom={false}
                      doubleClickZoom={false}
                      touchZoom={false}
                      attributionControl={false}
                    >
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <Marker
                        position={[clockModalPosition.latitude, clockModalPosition.longitude]}
                        icon={marcadorIcon}
                      />
                    </MapContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 mb-4 min-h-[3.5rem] flex items-center">
                    {clockModalStatus === 'geocoding' ? (
                      <p className="text-gray-500 text-sm flex items-center gap-2">
                        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin"></span>
                        Identificando endereço...
                      </p>
                    ) : (
                      <p className="text-gray-700 text-sm">
                        📍 {clockModalAddress || 'Endereço não identificado (coordenadas capturadas normalmente)'}
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 mb-4 text-center">
                    Esta é a sua localização atual, obtida pelo GPS do dispositivo. Não é possível alterá-la manualmente.
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={handleCloseClockModal}
                      className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirmClockIn}
                      disabled={clockModalStatus !== 'ready' || isConfirmingClockIn}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConfirmingClockIn ? 'Registrando...' : 'Confirmar Registro'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlePonto;
